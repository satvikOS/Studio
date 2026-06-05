// ArchDisc Studio V3 — EEVEE-style SSGI + SSR composer chain installer.
//
// installEevee() is the wiring between the EeveePanel state, the
// ShaderPass wrappers in passes.js, and the slice-684 viewport composer
// (`__archdiscViewport.__studioComposer`). The flow:
//
//   1. On first toggle, build the depth + normal aux buffers sized to the
//      live renderer canvas, build the SSGI + SSR ShaderPasses pointing at
//      those buffers, and remember everything inside _ctx.
//
//   2. If the viewport already has a composer (e.g. user toggled the
//      outline pass and api.js created one), insert our passes immediately
//      before the final OutputPass. If no composer exists we build one and
//      assign it to vp.__studioComposer (mirroring the api.js outline-pass
//      bootstrap so other slices like FXAA / Bloom keep working).
//
//   3. Install a tick into the viewport's __studioAnimTick chain that
//      re-renders the aux buffers from the live scene every frame. The
//      passes already point at the aux RTs, so the ShaderPasses pick up
//      the fresh depth + normal on the next composer.render() automatically.
//
//   4. Toggling a pass off removes it from the composer's `passes` array
//      via removePass(); the aux buffers stick around until both SSGI and
//      SSR are off, then we dispose them and drop the tick.
//
// Idempotent: enable/disable calls are safe to repeat. Resize is handled
// inside the tick by observing the renderer's domElement size.

import * as THREE from 'three';
import {
  createSSGIPass,
  createSSRPass,
  createAuxBuffers,
  resizeAuxBuffers,
  disposeAuxBuffers,
  renderAuxBuffers,
} from './passes.js';

const _ctx = {
  ssgi: false,
  ssr: false,
  intensity: 1.0,
  radius: 0.08,
  ssrDistance: 0.5,
  ssrStep: 0.02,
  aux: null,        // { depthRT, normalRT, normalMat, width, height }
  ssgiPass: null,
  ssrPass: null,
  ownsComposer: false,
  composer: null,
  tickInstalled: false,
};

function _viewport() {
  return (typeof window !== 'undefined') ? window.__archdiscViewport : null;
}

function _renderer() {
  const vp = _viewport();
  return vp && vp.renderer;
}

function _scene() {
  const vp = _viewport();
  return (vp && vp.scene) || (typeof window !== 'undefined' ? window.__archdiscScene : null);
}

function _camera() {
  const vp = _viewport();
  return vp && vp.camera;
}

function _composer() {
  const vp = _viewport();
  return vp && vp.__studioComposer;
}

function _canvasSize() {
  const r = _renderer();
  if (!r || !r.domElement) return { w: 1, h: 1 };
  const w = Math.max(1, Math.floor(r.domElement.clientWidth || r.domElement.width || 1));
  const h = Math.max(1, Math.floor(r.domElement.clientHeight || r.domElement.height || 1));
  return { w, h };
}

// Ensure a composer exists. If the host viewport doesn't already have
// one we build a barebones EffectComposer + RenderPass + OutputPass and
// assign it to vp.__studioComposer so subsequent post-effect slices keep
// working. We remember whether we own it so disposal logic in disable()
// knows whether to tear it back down.
async function _ensureComposer() {
  const vp = _viewport();
  if (!vp) return null;
  if (vp.__studioComposer) return vp.__studioComposer;
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
  _ctx.ownsComposer = true;
  _ctx.composer = composer;
  return composer;
}

// Insert a pass just before the terminal pass (OutputPass / ToneMappingPass)
// so colour output goes through the gamma/tone pipeline as intended.
function _insertBeforeOutput(composer, pass) {
  if (!composer || !pass) return;
  const passes = composer.passes;
  // If the last pass looks like a terminal output pass, slot just before it.
  const insertAt = Math.max(0, passes.length - 1);
  composer.insertPass(pass, insertAt);
}

function _ensureAux() {
  if (_ctx.aux) return _ctx.aux;
  const { w, h } = _canvasSize();
  _ctx.aux = createAuxBuffers(w, h);
  return _ctx.aux;
}

function _installTick() {
  if (_ctx.tickInstalled) return true;
  const vp = _viewport();
  if (!vp) return false;
  const prev = vp.__studioAnimTick;
  const fn = (now) => {
    try {
      if ((_ctx.ssgi || _ctx.ssr) && _ctx.aux) {
        // Resize-on-the-fly: keep aux buffers and uniforms in sync with
        // the renderer canvas. The composer is sized by the host loop /
        // installEevee resize hook below.
        const { w, h } = _canvasSize();
        const resized = resizeAuxBuffers(_ctx.aux, w, h);
        if (resized) {
          if (_ctx.ssgiPass) _ctx.ssgiPass.eeveeSetResolution(w, h);
          if (_ctx.ssrPass)  _ctx.ssrPass.eeveeSetResolution(w, h);
          if (_ctx.composer) {
            try { _ctx.composer.setSize(w, h); } catch (_) {}
          }
        }
        const r = _renderer();
        const s = _scene();
        const c = _camera();
        if (r && s && c) {
          renderAuxBuffers(r, s, c, _ctx.aux);
          // Make sure passes see the (possibly recreated) aux textures.
          if (_ctx.ssgiPass) _ctx.ssgiPass.eeveeUpdateAux(_ctx.aux.depthRT, _ctx.aux.normalRT);
          if (_ctx.ssrPass)  _ctx.ssrPass.eeveeUpdateAux(_ctx.aux.depthRT, _ctx.aux.normalRT);
        }
        if (_ctx.ssgiPass) _ctx.ssgiPass.eeveeBumpSeed();
        if (_ctx.ssrPass)  _ctx.ssrPass.eeveeBumpSeed();
      }
    } catch (_) {
      // Never blow up the host render loop.
    }
    if (prev) {
      try { prev(now); } catch (_) {}
    }
  };
  fn.__eevee = true;
  fn.__prev = prev;
  vp.__studioAnimTick = fn;
  _ctx.tickInstalled = true;
  return true;
}

function _uninstallTick() {
  if (!_ctx.tickInstalled) return;
  const vp = _viewport();
  if (!vp) { _ctx.tickInstalled = false; return; }
  // Walk the tick chain and unlink any node tagged __eevee.
  let head = vp.__studioAnimTick;
  if (head && head.__eevee) {
    vp.__studioAnimTick = head.__prev || null;
  } else {
    // Reconstruct chain skipping any __eevee node.
    const chain = [];
    let n = head;
    while (n) {
      if (!n.__eevee) chain.push(n);
      n = n.__prev || null;
    }
    let next = null;
    for (let i = chain.length - 1; i >= 0; i--) {
      const f = chain[i];
      f.__prev = next;
      next = f;
    }
    vp.__studioAnimTick = next;
  }
  _ctx.tickInstalled = false;
}

// ── Public installer ──────────────────────────────────────────────────────

export async function enableSSGI() {
  if (_ctx.ssgi) return { ok: true, on: true, already: true };
  const composer = await _ensureComposer();
  if (!composer) return { ok: false, error: 'no composer or viewport' };
  _ctx.composer = composer;
  _ensureAux();
  const { w, h } = _canvasSize();
  if (!_ctx.ssgiPass) {
    _ctx.ssgiPass = createSSGIPass({
      depthRT: _ctx.aux.depthRT,
      normalRT: _ctx.aux.normalRT,
      width: w,
      height: h,
      intensity: _ctx.intensity,
      radius: _ctx.radius,
    });
  }
  _insertBeforeOutput(composer, _ctx.ssgiPass);
  _ctx.ssgi = true;
  _installTick();
  return { ok: true, on: true };
}

export function disableSSGI() {
  if (!_ctx.ssgi) return { ok: true, on: false };
  const composer = _composer() || _ctx.composer;
  if (composer && _ctx.ssgiPass) {
    try { composer.removePass(_ctx.ssgiPass); } catch (_) {}
  }
  _ctx.ssgi = false;
  _maybeTeardownAux();
  return { ok: true, on: false };
}

export async function enableSSR() {
  if (_ctx.ssr) return { ok: true, on: true, already: true };
  const composer = await _ensureComposer();
  if (!composer) return { ok: false, error: 'no composer or viewport' };
  _ctx.composer = composer;
  _ensureAux();
  const { w, h } = _canvasSize();
  if (!_ctx.ssrPass) {
    _ctx.ssrPass = createSSRPass({
      depthRT: _ctx.aux.depthRT,
      normalRT: _ctx.aux.normalRT,
      width: w,
      height: h,
      maxDistance: _ctx.ssrDistance,
      step: _ctx.ssrStep,
      intensity: 1.0,
    });
  }
  _insertBeforeOutput(composer, _ctx.ssrPass);
  _ctx.ssr = true;
  _installTick();
  return { ok: true, on: true };
}

export function disableSSR() {
  if (!_ctx.ssr) return { ok: true, on: false };
  const composer = _composer() || _ctx.composer;
  if (composer && _ctx.ssrPass) {
    try { composer.removePass(_ctx.ssrPass); } catch (_) {}
  }
  _ctx.ssr = false;
  _maybeTeardownAux();
  return { ok: true, on: false };
}

function _maybeTeardownAux() {
  if (_ctx.ssgi || _ctx.ssr) return;
  // Both off → drop tick + aux. Keep pass objects so re-enable is cheap;
  // they hold no GPU resources that grow with viewport size beyond the
  // shader program itself.
  _uninstallTick();
  if (_ctx.aux) {
    disposeAuxBuffers(_ctx.aux);
    _ctx.aux = null;
  }
  // If we created the composer and nothing else holds it, drop it.
  if (_ctx.ownsComposer && _ctx.composer) {
    const composer = _ctx.composer;
    // Don't tear down if other slices appended passes (more than our two,
    // the RenderPass, and the OutputPass).
    const otherPasses = (composer.passes || []).filter((p) => {
      if (!p) return false;
      const kind = p.__eeveeKind;
      if (kind === 'ssgi' || kind === 'ssr') return false;
      if (p.constructor && (p.constructor.name === 'RenderPass'
        || p.constructor.name === 'OutputPass')) return false;
      return true;
    });
    if (otherPasses.length === 0) {
      try { composer.dispose && composer.dispose(); } catch (_) {}
      const vp = _viewport();
      if (vp && vp.__studioComposer === composer) vp.__studioComposer = null;
      _ctx.composer = null;
      _ctx.ownsComposer = false;
    }
  }
}

export function setIntensity(v) {
  _ctx.intensity = Math.max(0, Math.min(2, Number(v) || 0));
  if (_ctx.ssgiPass) _ctx.ssgiPass.eeveeSetIntensity(_ctx.intensity);
  return { ok: true, intensity: _ctx.intensity };
}

export function setSSRMaxDistance(v) {
  _ctx.ssrDistance = Math.max(0.05, Math.min(2.0, Number(v) || 0.5));
  if (_ctx.ssrPass) _ctx.ssrPass.eeveeSetMaxDistance(_ctx.ssrDistance);
  return { ok: true, ssrDistance: _ctx.ssrDistance };
}

export function getState() {
  return {
    ok: true,
    ssgi: !!_ctx.ssgi,
    ssr: !!_ctx.ssr,
    intensity: _ctx.intensity,
    ssrDistance: _ctx.ssrDistance,
    radius: _ctx.radius,
    hasAux: !!_ctx.aux,
    ownsComposer: !!_ctx.ownsComposer,
    composerPassCount: (_ctx.composer && _ctx.composer.passes) ? _ctx.composer.passes.length : 0,
  };
}

export function resetDefaults() {
  _ctx.intensity = 1.0;
  _ctx.ssrDistance = 0.5;
  _ctx.radius = 0.08;
  if (_ctx.ssgiPass) {
    _ctx.ssgiPass.eeveeSetIntensity(_ctx.intensity);
    _ctx.ssgiPass.eeveeSetRadius(_ctx.radius);
  }
  if (_ctx.ssrPass) {
    _ctx.ssrPass.eeveeSetMaxDistance(_ctx.ssrDistance);
  }
  return { ok: true };
}

export function teardown() {
  disableSSGI();
  disableSSR();
  if (_ctx.ssgiPass) { try { _ctx.ssgiPass.dispose && _ctx.ssgiPass.dispose(); } catch (_) {} _ctx.ssgiPass = null; }
  if (_ctx.ssrPass)  { try { _ctx.ssrPass.dispose  && _ctx.ssrPass.dispose();  } catch (_) {} _ctx.ssrPass = null; }
  _maybeTeardownAux();
}

// Used by EeveePanel to re-render in lockstep with state changes from
// op calls — no React subscription needed beyond a polling tick.
export const __internals__ = { _ctx };
