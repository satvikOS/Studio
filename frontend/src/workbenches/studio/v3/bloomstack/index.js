// ArchDisc Studio V3 — bloom + post-process stack (slice 857 → slice 918).
//
// Slice 918 replaces the slice-857 config-only stub with a REAL composer
// chain:
//
//   - UnrealBloomPass from three/examples/jsm/postprocessing — drives the
//     Unreal-style bright-pass + gaussian-blur bloom we toggle via
//     __studioBloomSet.
//   - Custom ShaderPasses for vignette / film grain / chromatic
//     aberration (see vignetteShader.js / grainShader.js / chromAbShader.js).
//
// All four passes are inserted just before the terminal OutputPass on
// vp.__studioComposer (the same composer slice 752 and Viewport3D.jsx
// drive each frame). If no composer exists yet we build a minimal one
// (RenderPass + OutputPass) sized to the canvas; if the EEVEE renderer
// (slice ~870) already built one we reuse it.
//
// Each toggle op flips _on for that effect and either inserts the pass
// into the composer or removes it — the per-frame render loop in
// Viewport3D.jsx is what actually does composer.render(); we just wire
// passes in and out + tick the grain time uniform.
//
// Ops surface (unchanged from slice 857 brief):
//   __studioBloomSet({ on, intensity, threshold, radius })
//   __studioVignetteSet({ on, intensity })
//   __studioGrainSet({ on, intensity })
//   __studioChromAbSet({ on, intensity })
//   __studioPostStackGetState()

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';
import { VignetteShader } from './vignetteShader.js';
import { GrainShader }    from './grainShader.js';
import { ChromAbShader }  from './chromAbShader.js';

let _installed = false;

const _state = {
  bloom:    { on: false, intensity: 0.8, threshold: 0.9, radius: 0.8 },
  vignette: { on: false, intensity: 0.3 },
  grain:    { on: false, intensity: 0.05 },
  chromAb:  { on: false, intensity: 0.005 },
};

// Pass instances + composer ownership; populated lazily on first toggle.
const _ctx = {
  composer:      null,
  ownsComposer:  false,
  bloomPass:     null,
  vignettePass:  null,
  grainPass:     null,
  chromAbPass:   null,
  tickInstalled: false,
  startedAt:     0,
};

// ── Three / addon module cache ───────────────────────────────────────────
//
// All addon modules are lazy-loaded the first time a pass is requested so
// the registry op surface registers cheaply even if the user never opens
// the stack.

let _mods = null;
async function _loadModules() {
  if (_mods) return _mods;
  const [composerMod, renderMod, outputMod, shaderMod, bloomMod] = await Promise.all([
    import('three/examples/jsm/postprocessing/EffectComposer.js'),
    import('three/examples/jsm/postprocessing/RenderPass.js'),
    import('three/examples/jsm/postprocessing/OutputPass.js'),
    import('three/examples/jsm/postprocessing/ShaderPass.js'),
    import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
  ]);
  _mods = {
    EffectComposer: composerMod.EffectComposer,
    RenderPass:     renderMod.RenderPass,
    OutputPass:     outputMod.OutputPass,
    ShaderPass:     shaderMod.ShaderPass,
    UnrealBloomPass: bloomMod.UnrealBloomPass,
  };
  return _mods;
}

// ── Viewport accessors ───────────────────────────────────────────────────

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
function _canvasSize() {
  const r = _renderer();
  if (!r || !r.domElement) return { w: 1, h: 1 };
  const w = Math.max(1, Math.floor(r.domElement.clientWidth || r.domElement.width || 1));
  const h = Math.max(1, Math.floor(r.domElement.clientHeight || r.domElement.height || 1));
  return { w, h };
}

// ── Composer bootstrap ───────────────────────────────────────────────────

async function _ensureComposer() {
  const vp = _viewport();
  if (!vp) return null;
  if (vp.__studioComposer) {
    _ctx.composer = vp.__studioComposer;
    return _ctx.composer;
  }
  const r = _renderer(); const s = _scene(); const c = _camera();
  if (!r || !s || !c) return null;
  const { EffectComposer, RenderPass, OutputPass } = await _loadModules();
  const composer = new EffectComposer(r);
  composer.addPass(new RenderPass(s, c));
  composer.addPass(new OutputPass());
  const { w, h } = _canvasSize();
  composer.setSize(w, h);
  vp.__studioComposer = composer;
  _ctx.composer     = composer;
  _ctx.ownsComposer = true;
  return composer;
}

// Slot passes immediately before the terminal OutputPass so tone-mapping
// stays last in the chain (same insertion pattern used by EEVEE + api.js
// bloom toggle).
function _insertBeforeOutput(composer, pass) {
  if (!composer || !pass) return;
  const passes = composer.passes;
  const insertAt = Math.max(0, passes.length - 1);
  composer.insertPass(pass, insertAt);
}

function _removePass(composer, pass) {
  if (!composer || !pass) return;
  try { composer.removePass(pass); } catch (_) {}
}

// ── Pass builders ────────────────────────────────────────────────────────

async function _buildBloomPass() {
  const { UnrealBloomPass } = await _loadModules();
  const { w, h } = _canvasSize();
  const b = _state.bloom;
  const pass = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    b.intensity,
    b.radius,
    b.threshold,
  );
  pass.__bloomstackKind = 'bloom';
  return pass;
}

async function _buildVignettePass() {
  const { ShaderPass } = await _loadModules();
  // Clone the shader def so the uniforms are per-instance and not shared
  // with the module-level export.
  const def = {
    uniforms: {
      tDiffuse:   { value: null },
      uIntensity: { value: _state.vignette.intensity },
      uRadius:    { value: VignetteShader.uniforms.uRadius.value },
      uSoftness:  { value: VignetteShader.uniforms.uSoftness.value },
      uAspect:    { value: 1.0 },
    },
    vertexShader:   VignetteShader.vertexShader,
    fragmentShader: VignetteShader.fragmentShader,
  };
  const pass = new ShaderPass(def);
  pass.__bloomstackKind = 'vignette';
  const { w, h } = _canvasSize();
  pass.uniforms.uAspect.value = w / Math.max(1, h);
  return pass;
}

async function _buildGrainPass() {
  const { ShaderPass } = await _loadModules();
  const { w, h } = _canvasSize();
  const def = {
    uniforms: {
      tDiffuse:    { value: null },
      uIntensity:  { value: _state.grain.intensity },
      uTime:       { value: 0.0 },
      uResolution: { value: new THREE.Vector2(w, h) },
    },
    vertexShader:   GrainShader.vertexShader,
    fragmentShader: GrainShader.fragmentShader,
  };
  const pass = new ShaderPass(def);
  pass.__bloomstackKind = 'grain';
  return pass;
}

async function _buildChromAbPass() {
  const { ShaderPass } = await _loadModules();
  const def = {
    uniforms: {
      tDiffuse:   { value: null },
      uIntensity: { value: _state.chromAb.intensity },
    },
    vertexShader:   ChromAbShader.vertexShader,
    fragmentShader: ChromAbShader.fragmentShader,
  };
  const pass = new ShaderPass(def);
  pass.__bloomstackKind = 'chromab';
  return pass;
}

// ── Per-frame tick ───────────────────────────────────────────────────────
//
// We use the shared anim-tick helper to install a frame callback that
// keeps the grain uTime in sync, resizes passes on viewport changes, and
// keeps the vignette aspect uniform fresh.

function _installTick() {
  if (_ctx.tickInstalled) return;
  _ctx.startedAt = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();
  const ok = chainIntoAnimTick('bloomstack', (now) => {
    try {
      const { w, h } = _canvasSize();
      if (_ctx.composer) {
        try { _ctx.composer.setSize(w, h); } catch (_) {}
      }
      if (_ctx.bloomPass && _ctx.bloomPass.setSize) {
        try { _ctx.bloomPass.setSize(w, h); } catch (_) {}
      }
      if (_ctx.vignettePass) {
        _ctx.vignettePass.uniforms.uAspect.value = w / Math.max(1, h);
      }
      if (_ctx.grainPass) {
        _ctx.grainPass.uniforms.uResolution.value.set(w, h);
        _ctx.grainPass.uniforms.uTime.value =
          ((typeof now === 'number') ? now : Date.now()) * 0.001;
      }
    } catch (_) { /* never blow up the host loop */ }
  });
  if (ok && ok.ok) _ctx.tickInstalled = true;
}

function _maybeUninstallTick() {
  // Drop the tick only when every pass is off — saves a no-op chain link.
  if (_state.bloom.on || _state.vignette.on || _state.grain.on || _state.chromAb.on) return;
  if (!_ctx.tickInstalled) return;
  unchainFromAnimTick('bloomstack');
  _ctx.tickInstalled = false;
}

// ── Toggle handlers (mounted on window via op surface) ───────────────────

async function _setBloom({ on, intensity, threshold, radius } = {}) {
  // Stash config first so build / update reads the new values
  if (intensity != null) _state.bloom.intensity = +intensity;
  if (threshold != null) _state.bloom.threshold = +threshold;
  if (radius    != null) _state.bloom.radius    = +radius;
  if (_ctx.bloomPass) {
    _ctx.bloomPass.strength  = _state.bloom.intensity;
    _ctx.bloomPass.threshold = _state.bloom.threshold;
    _ctx.bloomPass.radius    = _state.bloom.radius;
  }
  if (on == null) return { ok: true, ..._state.bloom };
  const want = !!on;
  if (want === _state.bloom.on) return { ok: true, ..._state.bloom, already: true };
  const composer = await _ensureComposer();
  if (!composer) return { ok: false, error: 'no composer', ..._state.bloom };
  if (want) {
    if (!_ctx.bloomPass) _ctx.bloomPass = await _buildBloomPass();
    _insertBeforeOutput(composer, _ctx.bloomPass);
    _state.bloom.on = true;
    _installTick();
  } else {
    _removePass(composer, _ctx.bloomPass);
    _state.bloom.on = false;
    _maybeUninstallTick();
  }
  return { ok: true, ..._state.bloom };
}

async function _setVignette({ on, intensity } = {}) {
  if (intensity != null) _state.vignette.intensity = +intensity;
  if (_ctx.vignettePass) {
    _ctx.vignettePass.uniforms.uIntensity.value = _state.vignette.intensity;
  }
  if (on == null) return { ok: true, ..._state.vignette };
  const want = !!on;
  if (want === _state.vignette.on) return { ok: true, ..._state.vignette, already: true };
  const composer = await _ensureComposer();
  if (!composer) return { ok: false, error: 'no composer', ..._state.vignette };
  if (want) {
    if (!_ctx.vignettePass) _ctx.vignettePass = await _buildVignettePass();
    _insertBeforeOutput(composer, _ctx.vignettePass);
    _state.vignette.on = true;
    _installTick();
  } else {
    _removePass(composer, _ctx.vignettePass);
    _state.vignette.on = false;
    _maybeUninstallTick();
  }
  return { ok: true, ..._state.vignette };
}

async function _setGrain({ on, intensity } = {}) {
  if (intensity != null) _state.grain.intensity = +intensity;
  if (_ctx.grainPass) {
    _ctx.grainPass.uniforms.uIntensity.value = _state.grain.intensity;
  }
  if (on == null) return { ok: true, ..._state.grain };
  const want = !!on;
  if (want === _state.grain.on) return { ok: true, ..._state.grain, already: true };
  const composer = await _ensureComposer();
  if (!composer) return { ok: false, error: 'no composer', ..._state.grain };
  if (want) {
    if (!_ctx.grainPass) _ctx.grainPass = await _buildGrainPass();
    _insertBeforeOutput(composer, _ctx.grainPass);
    _state.grain.on = true;
    _installTick();
  } else {
    _removePass(composer, _ctx.grainPass);
    _state.grain.on = false;
    _maybeUninstallTick();
  }
  return { ok: true, ..._state.grain };
}

async function _setChromAb({ on, intensity } = {}) {
  if (intensity != null) _state.chromAb.intensity = +intensity;
  if (_ctx.chromAbPass) {
    _ctx.chromAbPass.uniforms.uIntensity.value = _state.chromAb.intensity;
  }
  if (on == null) return { ok: true, ..._state.chromAb };
  const want = !!on;
  if (want === _state.chromAb.on) return { ok: true, ..._state.chromAb, already: true };
  const composer = await _ensureComposer();
  if (!composer) return { ok: false, error: 'no composer', ..._state.chromAb };
  if (want) {
    if (!_ctx.chromAbPass) _ctx.chromAbPass = await _buildChromAbPass();
    _insertBeforeOutput(composer, _ctx.chromAbPass);
    _state.chromAb.on = true;
    _installTick();
  } else {
    _removePass(composer, _ctx.chromAbPass);
    _state.chromAb.on = false;
    _maybeUninstallTick();
  }
  return { ok: true, ..._state.chromAb };
}

function _getState() {
  return {
    ok: true,
    bloom:    { ..._state.bloom },
    vignette: { ..._state.vignette },
    grain:    { ..._state.grain },
    chromAb:  { ..._state.chromAb },
    composerPassCount: (_ctx.composer && _ctx.composer.passes) ? _ctx.composer.passes.length : 0,
    ownsComposer: !!_ctx.ownsComposer,
  };
}

// ── Installer ────────────────────────────────────────────────────────────

export function installBloomStack() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioBloomSet:        _setBloom,
    __studioVignetteSet:     _setVignette,
    __studioGrainSet:        _setGrain,
    __studioChromAbSet:      _setChromAb,
    __studioPostStackGetState: _getState,
  };
  for (const [n, fn] of Object.entries(ops)) {
    if (typeof window !== 'undefined') window[n] = fn;
  }
  registerOps(ops, 'compositing',
    'Bloom + post-process stack — UnrealBloomPass + custom vignette/grain/chrom-ab ShaderPasses');
  return { ok: true };
}

export default installBloomStack;

// Internal hook so tests / debug consoles can poke the live state without
// re-walking window globals.
export const __internals__ = { _state, _ctx };
