// ArchDisc Studio V3 — slice 915 — REAL screen-space reflections.
//
// Replaces the slice-796 config stub.  Now wires a true ShaderPass into
// the slice-684 viewport composer chain (created on demand) and renders
// dedicated depth + view-space normal aux buffers each frame.  The
// fragment shader (see ./ssrShader.js) does a view-space ray march with
// inverse-projection reconstruction + binary refinement on hit + screen
// edge / distance / grazing-angle fades.  No SSAOPass-style scene
// re-rendering inside the pass: the heavy work is one fullscreen quad.
//
// Public ops (kept compatible with slice 796):
//   __studioSSREnable({ on, samples, maxDistance, fadeStart })
//       on/off + tuning.  Builds & inserts the pass on the first
//       on=true call, removes it on on=false.
//   __studioSSRSetIntensity({ i })
//       Mix factor 0..2 — kept for parity with the stub API.
//   __studioSSRGetStats()
//       Runtime perf + uniform mirror: ms-per-frame EMA, last-frame
//       step count, pass-installed boolean, etc.
//
// Lifecycle (idempotent):
//   1. installSSRFX()       — register ops on window + palette.  Cheap.
//   2. SSREnable({on:true}) — lazy-load EffectComposer / RenderPass /
//                             OutputPass / ShaderPass via dynamic import,
//                             build aux RTs sized to the live canvas,
//                             install per-frame tick into __studioAnimTick.
//   3. SSREnable({on:false})— remove pass from composer, uninstall tick,
//                             dispose aux buffers.  Composer survives
//                             if any other slice (outline/bloom/FXAA…)
//                             owns passes on it.
//
// Build-time guarantees:
//   - All three/examples/jsm imports are dynamic so the v3 bundle stays
//     lazy.  None of them are pulled in unless SSR actually gets enabled.
//   - No external dependencies beyond three + three/examples (already a
//     direct dep of the project — see api.js outline-pass for prior art).

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';
import { SSRShader } from './ssrShader.js';

let _installed = false;

// Persistent state — mirrors the slice 796 stub keys so any caller that
// still talks the old contract keeps working.
const _state = {
  on:           false,
  samples:      24,
  maxDistance:  4.0,
  fadeStart:    0.7,
  intensity:    1.0,
  thickness:    0.5,
};

// Runtime context.  Cleared when SSR is disabled and we own the composer.
const _rt = {
  pass:        null,    // THREE ShaderPass instance
  composer:    null,    // THREE EffectComposer
  ownsComposer:false,
  aux:         null,    // { depthRT, normalRT, normalMat, width, height }
  tickInstalled: false,
  proj:        null,    // THREE.Matrix4 for uProjection uniform
  invProj:     null,    // THREE.Matrix4 for uInverseProj uniform
  resolution:  null,    // THREE.Vector2 for uResolution uniform
  // Perf telemetry, all EMA-smoothed for /stats reporting.
  ema: {
    frameMs:     0,
    auxRenderMs: 0,
    composerMs:  0,
    lastFrameAt: 0,
    frameCount:  0,
  },
};

function _vp() {
  return (typeof window !== 'undefined') ? window.__archdiscViewport : null;
}
function _renderer() {
  const v = _vp();
  return v && v.renderer;
}
function _scene() {
  const v = _vp();
  return (v && v.scene) || (typeof window !== 'undefined' ? window.__archdiscScene : null);
}
function _camera() {
  const v = _vp();
  return v && v.camera;
}
function _canvasSize() {
  const r = _renderer();
  if (!r || !r.domElement) return { w: 1, h: 1 };
  const dom = r.domElement;
  const w = Math.max(1, Math.floor(dom.clientWidth  || dom.width  || 1));
  const h = Math.max(1, Math.floor(dom.clientHeight || dom.height || 1));
  return { w, h };
}
function _now() {
  return (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
}

// ── Aux buffers (depth + view-space normals) ─────────────────────────────

function _createAuxBuffers(w, h) {
  const W = Math.max(1, Math.floor(w));
  const H = Math.max(1, Math.floor(h));
  const depthRT = new THREE.WebGLRenderTarget(W, H, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format:    THREE.RGBAFormat,
    type:      THREE.UnsignedByteType,
    stencilBuffer:  false,
    generateMipmaps: false,
  });
  depthRT.depthTexture = new THREE.DepthTexture(W, H);
  depthRT.depthTexture.format = THREE.DepthFormat;
  depthRT.depthTexture.type   = THREE.UnsignedShortType;

  const normalRT = new THREE.WebGLRenderTarget(W, H, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format:    THREE.RGBAFormat,
    type:      THREE.UnsignedByteType,
    depthBuffer:    true,
    stencilBuffer:  false,
    generateMipmaps: false,
  });
  const normalMat = new THREE.MeshNormalMaterial();
  return { depthRT, normalRT, normalMat, width: W, height: H };
}

function _resizeAux(aux, w, h) {
  const W = Math.max(1, Math.floor(w));
  const H = Math.max(1, Math.floor(h));
  if (aux.width === W && aux.height === H) return false;
  aux.depthRT.setSize(W, H);
  aux.normalRT.setSize(W, H);
  if (aux.depthRT.depthTexture) {
    aux.depthRT.depthTexture.image = { width: W, height: H };
    aux.depthRT.depthTexture.needsUpdate = true;
  }
  aux.width = W;
  aux.height = H;
  return true;
}

function _disposeAux(aux) {
  if (!aux) return;
  try { aux.depthRT.dispose();  } catch (_) {}
  try { aux.normalRT.dispose(); } catch (_) {}
  try { aux.normalMat.dispose();} catch (_) {}
}

// Render scene → depth + normal aux RTs.  Same dual-pass pattern as
// v3/eevee/passes.js but kept local so SSR doesn't reach into another
// slice's internals.
function _renderAux(renderer, scene, camera, aux) {
  const prevTarget   = renderer.getRenderTarget();
  const prevAuto     = renderer.autoClear;
  const prevOverride = scene.overrideMaterial;
  const prevAlpha    = renderer.getClearAlpha();
  const prevClear    = new THREE.Color();
  renderer.getClearColor(prevClear);

  // Depth pass — keep original materials so depth z is accurate.
  renderer.setRenderTarget(aux.depthRT);
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;
  scene.overrideMaterial = null;
  renderer.render(scene, camera);

  // Normal pass — override every mesh with MeshNormalMaterial; the
  // colour attachment then carries view-space normals encoded as
  // RGB = N*0.5 + 0.5.
  renderer.setRenderTarget(aux.normalRT);
  renderer.setClearColor(0x808080, 1);
  scene.overrideMaterial = aux.normalMat;
  renderer.render(scene, camera);

  // Restore.
  scene.overrideMaterial = prevOverride;
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAuto;
}

// ── Composer + pass plumbing ─────────────────────────────────────────────

async function _ensureComposer() {
  const vp = _vp();
  if (!vp) return null;
  if (vp.__studioComposer) {
    _rt.composer = vp.__studioComposer;
    return _rt.composer;
  }
  const r = _renderer();
  const s = _scene();
  const c = _camera();
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
  _rt.composer = composer;
  _rt.ownsComposer = true;
  return composer;
}

async function _ensurePass() {
  if (_rt.pass) return _rt.pass;
  const { ShaderPass } = await import('three/examples/jsm/postprocessing/ShaderPass.js');
  // Clone the shader template so uniform references are unique.
  // (ShaderPass(shader) copies uniforms via UniformsUtils.clone internally.)
  const pass = new ShaderPass(SSRShader);
  pass.needsSwap = true;
  pass.__ssrfxKind = 'ssr';

  // The shader template doesn't ship Matrix4/Vector2 instances (it stays
  // pure GLSL strings + literal defaults).  Allocate the GPU-side objects
  // here and pin them onto _rt so we can mutate uniforms cheaply each
  // frame.
  _rt.proj       = new THREE.Matrix4();
  _rt.invProj    = new THREE.Matrix4();
  _rt.resolution = new THREE.Vector2();
  pass.uniforms.uProjection.value  = _rt.proj;
  pass.uniforms.uInverseProj.value = _rt.invProj;
  pass.uniforms.uResolution.value  = _rt.resolution;
  pass.uniforms.uSamples.value     = _state.samples;
  pass.uniforms.uMaxDistance.value = _state.maxDistance;
  pass.uniforms.uFadeStart.value   = _state.fadeStart;
  pass.uniforms.uIntensity.value   = _state.intensity;
  pass.uniforms.uThickness.value   = _state.thickness;
  pass.uniforms.uFrameSeed.value   = Math.random();
  _rt.pass = pass;
  return pass;
}

function _insertBeforeOutput(composer, pass) {
  if (!composer || !pass) return;
  const passes = composer.passes || [];
  // Already inserted?
  if (passes.indexOf(pass) >= 0) return;
  const insertAt = Math.max(0, passes.length - 1);
  composer.insertPass(pass, insertAt);
}

function _removeFromComposer(composer, pass) {
  if (!composer || !pass) return;
  try { composer.removePass(pass); } catch (_) {}
}

// ── Per-frame tick ───────────────────────────────────────────────────────

function _installTick() {
  if (_rt.tickInstalled) return true;
  const ok = chainIntoAnimTick('ssrfx', () => {
    if (!_state.on) return;
    const r = _renderer();
    const s = _scene();
    const c = _camera();
    if (!r || !s || !c || !_rt.pass || !_rt.aux) return;
    try {
      const t0 = _now();
      const { w, h } = _canvasSize();
      const resized = _resizeAux(_rt.aux, w, h);
      if (resized) {
        if (_rt.resolution) _rt.resolution.set(w, h);
        if (_rt.composer)   { try { _rt.composer.setSize(w, h); } catch (_) {} }
      } else if (_rt.resolution) {
        _rt.resolution.set(w, h);
      }

      // Render depth + normal aux buffers.
      const a0 = _now();
      _renderAux(r, s, c, _rt.aux);
      _rt.ema.auxRenderMs = _rt.ema.auxRenderMs * 0.9 + (_now() - a0) * 0.1;

      // Update uniforms.
      const pass = _rt.pass;
      pass.uniforms.tDepth.value  = _rt.aux.depthRT.depthTexture;
      pass.uniforms.tNormal.value = _rt.aux.normalRT.texture;
      // Camera matrices.  three.js stores projectionMatrix on the camera;
      // projectionMatrixInverse is auto-updated by Camera.updateProjectionMatrix.
      if (c.projectionMatrix) {
        _rt.proj.copy(c.projectionMatrix);
      }
      if (c.projectionMatrixInverse) {
        _rt.invProj.copy(c.projectionMatrixInverse);
      } else {
        _rt.invProj.copy(_rt.proj).invert();
      }
      pass.uniforms.uFrameSeed.value = Math.random();
      pass.uniforms.uSamples.value     = _state.samples;
      pass.uniforms.uMaxDistance.value = _state.maxDistance;
      pass.uniforms.uFadeStart.value   = _state.fadeStart;
      pass.uniforms.uIntensity.value   = _state.intensity;
      pass.uniforms.uThickness.value   = _state.thickness;

      _rt.ema.frameMs = _rt.ema.frameMs * 0.9 + (_now() - t0) * 0.1;
      _rt.ema.lastFrameAt = _now();
      _rt.ema.frameCount += 1;
    } catch (_) {
      // Never crash the host render loop.
    }
  });
  if (!ok || !ok.ok) return false;
  _rt.tickInstalled = true;
  return true;
}

function _uninstallTick() {
  if (!_rt.tickInstalled) return;
  unchainFromAnimTick('ssrfx');
  _rt.tickInstalled = false;
}

// ── Public lifecycle ─────────────────────────────────────────────────────

async function _enable() {
  if (_state.on && _rt.pass) return { ok: true, on: true, already: true };
  const composer = await _ensureComposer();
  if (!composer) return { ok: false, error: 'no viewport / composer' };
  const pass = await _ensurePass();

  const { w, h } = _canvasSize();
  if (!_rt.aux) _rt.aux = _createAuxBuffers(w, h);
  else _resizeAux(_rt.aux, w, h);
  if (_rt.resolution) _rt.resolution.set(w, h);

  pass.uniforms.tDepth.value  = _rt.aux.depthRT.depthTexture;
  pass.uniforms.tNormal.value = _rt.aux.normalRT.texture;

  _insertBeforeOutput(composer, pass);
  _installTick();
  _state.on = true;
  return { ok: true, on: true };
}

function _disable() {
  if (!_state.on) return { ok: true, on: false };
  if (_rt.composer && _rt.pass) _removeFromComposer(_rt.composer, _rt.pass);
  _uninstallTick();
  _state.on = false;

  // If we own the composer and no one else (FXAA / Bloom / outline / etc.)
  // has installed passes beyond the default Render + Output, tear it down.
  if (_rt.ownsComposer && _rt.composer) {
    const others = (_rt.composer.passes || []).filter((p) => {
      if (!p) return false;
      if (p.__ssrfxKind === 'ssr') return false;
      const n = p.constructor && p.constructor.name;
      if (n === 'RenderPass' || n === 'OutputPass') return false;
      return true;
    });
    if (others.length === 0) {
      try { _rt.composer.dispose && _rt.composer.dispose(); } catch (_) {}
      const vp = _vp();
      if (vp && vp.__studioComposer === _rt.composer) vp.__studioComposer = null;
      _rt.composer = null;
      _rt.ownsComposer = false;
    }
  }

  if (_rt.aux) {
    _disposeAux(_rt.aux);
    _rt.aux = null;
  }
  return { ok: true, on: false };
}

// ── Public ops ───────────────────────────────────────────────────────────

export function installSSRFX() {
  if (_installed) return { ok: true, already: true };
  _installed = true;

  const ops = {
    __studioSSREnable: async ({ on, samples, maxDistance, fadeStart, thickness } = {}) => {
      if (samples != null)      _state.samples     = Math.max(8, Math.min(64, (samples | 0) || 24));
      if (maxDistance != null)  _state.maxDistance = Math.max(0.1, Math.min(50.0, Number(maxDistance) || 4.0));
      if (fadeStart != null)    _state.fadeStart   = Math.max(0.0, Math.min(0.99, Number(fadeStart) || 0.7));
      if (thickness != null)    _state.thickness   = Math.max(0.01, Math.min(5.0, Number(thickness) || 0.5));
      // Live-apply tunings even if SSR is off (next enable picks them up).
      if (_rt.pass) {
        _rt.pass.uniforms.uSamples.value     = _state.samples;
        _rt.pass.uniforms.uMaxDistance.value = _state.maxDistance;
        _rt.pass.uniforms.uFadeStart.value   = _state.fadeStart;
        _rt.pass.uniforms.uThickness.value   = _state.thickness;
      }
      if (on === false) return _disable();
      if (on === true || on == null) return _enable();
      return { ok: true, ..._state };
    },

    __studioSSRSetIntensity: ({ i = 1 } = {}) => {
      _state.intensity = Math.max(0, Math.min(2, Number(i) || 0));
      if (_rt.pass) _rt.pass.uniforms.uIntensity.value = _state.intensity;
      return { ok: true, intensity: _state.intensity };
    },

    __studioSSRGetStats: () => ({
      ok: true,
      on:           !!_state.on,
      samples:      _state.samples,
      maxDistance:  _state.maxDistance,
      fadeStart:    _state.fadeStart,
      intensity:    _state.intensity,
      thickness:    _state.thickness,
      passInstalled: !!(_rt.pass && _rt.composer && (_rt.composer.passes || []).indexOf(_rt.pass) >= 0),
      ownsComposer: !!_rt.ownsComposer,
      composerPassCount: (_rt.composer && _rt.composer.passes) ? _rt.composer.passes.length : 0,
      hasAux:       !!_rt.aux,
      auxSize:      _rt.aux ? { w: _rt.aux.width, h: _rt.aux.height } : null,
      perf: {
        frameMs:     +(_rt.ema.frameMs).toFixed(3),
        auxRenderMs: +(_rt.ema.auxRenderMs).toFixed(3),
        frameCount:  _rt.ema.frameCount,
        lastFrameAt: _rt.ema.lastFrameAt,
      },
    }),
  };
  for (const [n, fn] of Object.entries(ops)) {
    if (typeof window !== 'undefined') window[n] = fn;
  }
  registerOps(ops, 'rt', 'Screen-space reflections (real ShaderPass)');
  return { ok: true };
}

// Exposed for tests / panels / sibling slices that want to inspect state.
export const __internals__ = { _state, _rt };

export default installSSRFX;
