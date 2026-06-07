// ArchDisc Studio V3 — Temporal Anti-Aliasing (slice 916).
//
// Real wired ShaderPass that:
//   1. Applies a low-discrepancy Halton (2,3) sub-pixel jitter to the
//      camera's projection matrix every frame (the canonical TAA pre-
//      condition — without this the resolve has nothing to integrate).
//   2. Runs a TAA resolve ShaderPass in the EffectComposer chain that:
//        • samples the current frame from tDiffuse,
//        • reprojects through the slice-798 motion-vector texture,
//        • computes a 3×3 colour AABB in YCoCg,
//        • clips the history sample to that AABB (Karis/Salvi method),
//        • blends current + clipped-history with a motion-adaptive α.
//   3. Maintains a WebGLRenderTarget as the history buffer; after each
//      composer.render() it copies the latest resolved pixels into the
//      history target via the renderer (no extra full-screen draw —
//      we capture the OutputPass colour by ping-ponging through a
//      dedicated capture pass at the end of the chain).
//   4. Wires into the existing render loop via the slice-684 viewport
//      composer pattern (`__archdiscViewport.__studioComposer`) — same
//      contract as slice-606 outline / slice-684 EEVEE SSGI+SSR.
//
// Ops (mirror legacy slice-797 surface, now actually do work):
//   __studioTAAEnable({ on, jitterScale, historyWeight })
//   __studioTAAReset()        — clears history, resets frame index
//   __studioTAAGetStats()     — sample count, frame index, jitter,
//                                composer pass count, on-state
//
// All shader-time logic lives in `./taaShader.js`; this file owns the
// JS-side state machine, composer wiring, and Halton jitter math.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';
import { TAA_VERTEX, TAA_FRAGMENT } from './taaShader.js';

// ── Halton low-discrepancy 1-D sequence ──────────────────────────────────
// f^-1 base-b van der Corput. Halton (2,3) is the textbook TAA pattern;
// 8-frame phase is enough to cover the sub-pixel area uniformly without
// visible periodicity at 60 fps.
function _halton(i, base) {
  let f = 1, r = 0;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

const HALTON_LEN = 8;

// ── Module state ────────────────────────────────────────────────────────
const _state = {
  installed: false,
  on: false,
  jitterScale: 1.0,                 // sub-pixel jitter amplitude multiplier
  historyWeight: 0.9,               // legacy knob; mapped to alphaStill = 1 - historyWeight
  alphaStill: 0.1,                  // blend α for stationary pixels
  alphaMotion: 0.5,                 // blend α for fast-moving pixels
  clampGamma: 1.25,                 // AABB widen factor
  frameIdx: 0,                      // total frames rendered since enable
  sampleCount: 0,                   // frames that landed in the resolved history
  historyValid: false,              // false until the first render fills history
  pass: null,                       // the TAA ShaderPass
  historyA: null,                   // WebGLRenderTarget — ping
  historyB: null,                   // WebGLRenderTarget — pong (current write target)
  motionTexture: null,              // optional motion-vector texture (slice 798)
  motionScale: 1.0,                 // host-supplied scale for the motion-vec encoding
  composer: null,                   // viewport composer the pass is installed on
  ownsComposer: false,
  tickInstalled: false,
  jitterAttached: false,
  prevProjectionMatrix: null,       // saved camera.projectionMatrix before jitter
  prevProjectionMatrixInverse: null,
  width: 1,
  height: 1,
};

// ── Helpers ──────────────────────────────────────────────────────────────
function _viewport() {
  return (typeof window !== 'undefined') ? window.__archdiscViewport : null;
}
function _renderer()  { const v = _viewport(); return v && v.renderer; }
function _scene()     {
  const v = _viewport();
  return (v && v.scene) || (typeof window !== 'undefined' ? window.__archdiscScene : null);
}
function _camera()    { const v = _viewport(); return v && v.camera; }

function _canvasSize() {
  const r = _renderer();
  if (!r || !r.domElement) return { w: 1, h: 1 };
  const dpr = r.getPixelRatio ? r.getPixelRatio() : 1;
  const w = Math.max(1, Math.floor((r.domElement.clientWidth  || r.domElement.width  || 1) * dpr));
  const h = Math.max(1, Math.floor((r.domElement.clientHeight || r.domElement.height || 1) * dpr));
  return { w, h };
}

function _makeHistoryTarget(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    stencilBuffer: false,
    depthBuffer: false,
    generateMipmaps: false,
  });
}

// Build the TAA ShaderPass. Held as a closure so we can attach helper
// methods (mirrors the slice-684 EEVEE pass pattern).
async function _buildPass() {
  const passMod = await import('three/examples/jsm/postprocessing/ShaderPass.js');
  const { w, h } = _canvasSize();
  _state.width = w;
  _state.height = h;
  if (!_state.historyA) _state.historyA = _makeHistoryTarget(w, h);
  if (!_state.historyB) _state.historyB = _makeHistoryTarget(w, h);

  const shader = {
    uniforms: {
      tDiffuse:       { value: null },
      tHistory:       { value: _state.historyA.texture },
      tMotion:        { value: _state.motionTexture },
      uResolution:    { value: new THREE.Vector2(w, h) },
      uHistoryValid:  { value: 0.0 },
      uAlphaStill:    { value: _state.alphaStill },
      uAlphaMotion:   { value: _state.alphaMotion },
      uMotionScale:   { value: _state.motionScale },
      uClampGamma:    { value: _state.clampGamma },
    },
    vertexShader: TAA_VERTEX,
    fragmentShader: TAA_FRAGMENT,
  };
  const pass = new passMod.ShaderPass(shader);
  pass.needsSwap = true;
  pass.__taaKind = 'taa';
  return pass;
}

// Ensure the host viewport has an EffectComposer. Mirrors the EEVEE
// renderer.js bootstrap — if a composer already exists (outline pass,
// SSGI, etc.) we share it; otherwise we build a minimal one and remember
// ownership for clean teardown.
async function _ensureComposer() {
  const vp = _viewport();
  if (!vp) return null;
  if (vp.__studioComposer) {
    _state.composer = vp.__studioComposer;
    return _state.composer;
  }
  const r = _renderer(), s = _scene(), c = _camera();
  if (!r || !s || !c) return null;
  const [composerMod, renderMod, outputMod] = await Promise.all([
    import('three/examples/jsm/postprocessing/EffectComposer.js'),
    import('three/examples/jsm/postprocessing/RenderPass.js'),
    import('three/examples/jsm/postprocessing/OutputPass.js'),
  ]);
  const composer = new composerMod.EffectComposer(r);
  composer.addPass(new renderMod.RenderPass(s, c));
  composer.addPass(new outputMod.OutputPass());
  const { w, h } = _canvasSize();
  composer.setSize(w, h);
  vp.__studioComposer = composer;
  _state.composer = composer;
  _state.ownsComposer = true;
  return composer;
}

// Insert just before the terminal output pass, same as SSGI/SSR/Bloom.
function _insertBeforeOutput(composer, pass) {
  if (!composer || !pass) return;
  const passes = composer.passes;
  const insertAt = Math.max(0, passes.length - 1);
  composer.insertPass(pass, insertAt);
}

// ── Halton jitter for camera.projectionMatrix ────────────────────────────
//
// We mutate projectionMatrix in place each frame and restore at the end
// of the composer.render(). The jitter is sub-pixel: dx/dy ∈ [-0.5, 0.5]
// of a pixel, mapped through the projection matrix as a translation in
// NDC. NDC delta per pixel = 2 / resolution.
function _applyJitter(camera) {
  if (!camera) return;
  if (!_state.prevProjectionMatrix) {
    _state.prevProjectionMatrix = new THREE.Matrix4();
    _state.prevProjectionMatrixInverse = new THREE.Matrix4();
  }
  _state.prevProjectionMatrix.copy(camera.projectionMatrix);
  _state.prevProjectionMatrixInverse.copy(camera.projectionMatrixInverse);

  const i = (_state.frameIdx % HALTON_LEN) + 1;
  const jx = (_halton(i, 2) - 0.5) * _state.jitterScale;
  const jy = (_halton(i, 3) - 0.5) * _state.jitterScale;
  const { w, h } = _canvasSize();
  const dx = (2.0 * jx) / Math.max(1, w);
  const dy = (2.0 * jy) / Math.max(1, h);

  // projectionMatrix[2,3] are the X/Y translation components in the
  // 4×4 column-major layout three.js uses (.elements [m00..m33]).
  // Index 8 is m02, index 9 is m12 — apply the NDC offset there.
  const e = camera.projectionMatrix.elements;
  e[8]  += dx;
  e[9]  += dy;
  // Inverse must be updated so screen-space pickers stay correct.
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

function _restoreJitter(camera) {
  if (!camera || !_state.prevProjectionMatrix) return;
  camera.projectionMatrix.copy(_state.prevProjectionMatrix);
  camera.projectionMatrixInverse.copy(_state.prevProjectionMatrixInverse);
}

// ── Per-frame tick: jitter → wait for composer to render → swap history ──
//
// The slice-684 viewport render loop renders the composer (when present)
// or the renderer directly. We hook the existing `__studioAnimTick` chain
// to (a) jitter BEFORE the composer renders and (b) swap the history
// after. Three.js' WebGLRenderer doesn't expose a "post-render" callback
// on EffectComposer, so we wrap the pass's render method to copy the
// just-written output texture into the history buffer on its way out.
function _installTick() {
  if (_state.tickInstalled) return true;
  const ok = chainIntoAnimTick('taa', () => {
    if (!_state.on || !_state.pass) return;
    // Resize check — track renderer.domElement size.
    const { w, h } = _canvasSize();
    if (w !== _state.width || h !== _state.height) {
      _state.width = w;
      _state.height = h;
      try { _state.historyA.setSize(w, h); } catch (_) {}
      try { _state.historyB.setSize(w, h); } catch (_) {}
      try {
        _state.pass.uniforms.uResolution.value.set(w, h);
      } catch (_) {}
      // Resize composer too if we own it; otherwise the host owns sizing.
      if (_state.ownsComposer && _state.composer) {
        try { _state.composer.setSize(w, h); } catch (_) {}
      }
      // Invalidate history on resize — the old texture is the wrong size.
      _state.historyValid = false;
    }
    // Apply jitter to the camera before the host composer renders.
    _applyJitter(_camera());
    // Wire the latest motion texture if motionvecfx exposes one.
    if (typeof window !== 'undefined' && typeof window.__studioMotionVecGetTexture === 'function') {
      try {
        const r = window.__studioMotionVecGetTexture();
        if (r && r.texture) {
          _state.motionTexture = r.texture;
          _state.pass.uniforms.tMotion.value = r.texture;
        }
      } catch (_) {}
    }
    // Set history-valid + bind the current history read texture.
    _state.pass.uniforms.uHistoryValid.value = _state.historyValid ? 1.0 : 0.0;
    _state.pass.uniforms.tHistory.value = _state.historyA.texture;
  });
  if (!ok || !ok.ok) return false;
  _state.tickInstalled = true;
  return true;
}

function _uninstallTick() {
  if (!_state.tickInstalled) return;
  unchainFromAnimTick('taa');
  _state.tickInstalled = false;
}

// Wrap the pass.render method so after we draw the resolved colour into
// writeBuffer we also blit it into the (write) history target. Then we
// swap A↔B so next frame samples from the just-resolved texture.
//
// Three's ShaderPass.render signature is render(renderer, writeBuffer,
// readBuffer, deltaTime, maskActive). We chain the original after
// stashing the write target.
function _wrapPassRender(pass) {
  if (!pass || pass.__taaWrapped) return;
  const originalRender = pass.render.bind(pass);
  pass.render = function(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    // Restore jitter into the camera right before the resolve pass runs
    // — by this point in the composer chain the scene has already been
    // rendered jittered into readBuffer (RenderPass earlier in the chain
    // saw the jittered camera). The resolve itself is a screen-space
    // pass and doesn't care about camera projection.
    _restoreJitter(_camera());

    // The resolve writes into `writeBuffer` (or null = screen if last
    // pass). We need the resolved pixels for the next frame's history.
    // If writeBuffer is non-null we can copy from it; if it's null we
    // need to redirect the resolve to historyB then re-blit to the
    // screen. The composer's renderToScreen flag is what decides null
    // vs writeBuffer — for our position (one-before-last) writeBuffer
    // is always non-null because we sit before OutputPass.
    originalRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);

    // Copy writeBuffer → historyB (next-frame read source) via a cheap
    // copy: we use a blit through a temporary clear-and-render. Three
    // doesn't expose a direct texture copy, but we can copy by binding
    // writeBuffer.texture as the source on a copy material we keep alive.
    if (writeBuffer && writeBuffer.texture) {
      _copyTextureToTarget(renderer, writeBuffer.texture, _state.historyB);
      // Swap A/B — next frame reads from the just-written B.
      const tmp = _state.historyA;
      _state.historyA = _state.historyB;
      _state.historyB = tmp;
      _state.historyValid = true;
      _state.sampleCount += 1;
    }
    _state.frameIdx += 1;
  };
  pass.__taaWrapped = true;
}

// ── Cheap texture copy via a dedicated copy quad ─────────────────────────
// We keep a single full-screen scene + quad alive so the copy is a single
// draw call. No new dependencies — pure three.js core.
let _copyScene = null;
let _copyCamera = null;
let _copyQuad = null;
let _copyMaterial = null;

function _ensureCopyResources() {
  if (_copyScene) return;
  _copyScene = new THREE.Scene();
  _copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  _copyMaterial = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tSrc;
      void main() { gl_FragColor = texture2D(tSrc, vUv); }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const geo = new THREE.PlaneGeometry(2, 2);
  _copyQuad = new THREE.Mesh(geo, _copyMaterial);
  _copyScene.add(_copyQuad);
}

function _copyTextureToTarget(renderer, srcTexture, dstRT) {
  if (!renderer || !srcTexture || !dstRT) return;
  _ensureCopyResources();
  _copyMaterial.uniforms.tSrc.value = srcTexture;
  const prevTarget = renderer.getRenderTarget();
  const prevAuto = renderer.autoClear;
  renderer.setRenderTarget(dstRT);
  renderer.autoClear = true;
  renderer.render(_copyScene, _copyCamera);
  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAuto;
}

// ── Public ops ───────────────────────────────────────────────────────────

async function _enable() {
  if (_state.on) return { ok: true, on: true, already: true };
  const composer = await _ensureComposer();
  if (!composer) return { ok: false, error: 'no composer or viewport' };
  if (!_state.pass) {
    _state.pass = await _buildPass();
    _wrapPassRender(_state.pass);
  }
  // Push uniforms in case knobs changed before enable.
  _syncUniforms();
  // Avoid double-insert on re-enable.
  const passes = composer.passes || [];
  if (!passes.includes(_state.pass)) {
    _insertBeforeOutput(composer, _state.pass);
  }
  _state.on = true;
  _state.historyValid = false; // first frame after enable can't read history
  _installTick();
  return { ok: true, on: true };
}

function _disable() {
  if (!_state.on) return { ok: true, on: false };
  if (_state.composer && _state.pass) {
    try { _state.composer.removePass(_state.pass); } catch (_) {}
  }
  _state.on = false;
  _state.historyValid = false;
  // Make sure the camera projection is restored if a tick was mid-flight.
  _restoreJitter(_camera());
  return { ok: true, on: false };
}

function _syncUniforms() {
  if (!_state.pass) return;
  try {
    _state.pass.uniforms.uAlphaStill.value  = _state.alphaStill;
    _state.pass.uniforms.uAlphaMotion.value = _state.alphaMotion;
    _state.pass.uniforms.uClampGamma.value  = _state.clampGamma;
    _state.pass.uniforms.uMotionScale.value = _state.motionScale;
  } catch (_) {}
}

function _reset() {
  _state.frameIdx = 0;
  _state.sampleCount = 0;
  _state.historyValid = false;
  // Clear both history targets so the next frame can't sample stale data.
  const r = _renderer();
  if (r) {
    for (const rt of [_state.historyA, _state.historyB]) {
      if (!rt) continue;
      const prevTarget = r.getRenderTarget();
      const prevColor = new THREE.Color();
      const prevAlpha = r.getClearAlpha();
      r.getClearColor(prevColor);
      r.setRenderTarget(rt);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, true);
      r.setRenderTarget(prevTarget);
      r.setClearColor(prevColor, prevAlpha);
    }
  }
  return { ok: true };
}

// ── Installer ────────────────────────────────────────────────────────────
export function installTAAFX() {
  if (_state.installed) return { ok: true, already: true };
  _state.installed = true;

  const ops = {
    __studioTAAEnable: ({ on, jitterScale, historyWeight, alphaStill, alphaMotion, clampGamma, motionScale } = {}) => {
      if (jitterScale != null)   _state.jitterScale   = Math.max(0, Math.min(4, Number(jitterScale)));
      if (historyWeight != null) {
        _state.historyWeight = Math.max(0, Math.min(1, Number(historyWeight)));
        // Map legacy `historyWeight` knob to alphaStill = 1 - weight.
        _state.alphaStill = Math.max(0.01, Math.min(1, 1 - _state.historyWeight));
      }
      if (alphaStill  != null) _state.alphaStill  = Math.max(0.01, Math.min(1, Number(alphaStill)));
      if (alphaMotion != null) _state.alphaMotion = Math.max(0.01, Math.min(1, Number(alphaMotion)));
      if (clampGamma  != null) _state.clampGamma  = Math.max(1.0, Math.min(2.0, Number(clampGamma)));
      if (motionScale != null) _state.motionScale = Math.max(0, Math.min(8, Number(motionScale)));
      _syncUniforms();
      if (on === false) {
        return _disable();
      }
      if (on === true || on == null) {
        // Default to enable when the op is called (legacy behaviour).
        return _enable();
      }
      return { ok: true, on: _state.on };
    },
    __studioTAAReset: () => _reset(),
    __studioTAAGetStats: () => {
      const i = (_state.frameIdx % HALTON_LEN) + 1;
      return {
        ok: true,
        on: _state.on,
        jitterScale: _state.jitterScale,
        historyWeight: _state.historyWeight,
        alphaStill: _state.alphaStill,
        alphaMotion: _state.alphaMotion,
        clampGamma: _state.clampGamma,
        motionScale: _state.motionScale,
        frameIdx: _state.frameIdx,
        sampleCount: _state.sampleCount,
        historyValid: _state.historyValid,
        jitter: [_halton(i, 2) - 0.5, _halton(i, 3) - 0.5],
        hasMotionTexture: !!_state.motionTexture,
        composerAttached: !!_state.composer,
        passCount: (_state.composer && _state.composer.passes) ? _state.composer.passes.length : 0,
      };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Temporal anti-aliasing');
  return { ok: true };
}

export const __internals__ = { _state, _halton, HALTON_LEN };

export default installTAAFX;
