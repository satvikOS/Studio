// ArchDisc Studio V3 — REAL FXAA 3.11 / SMAA / TAA anti-aliasing
// (slice 859 stub → slice 917 real impl).
//
// The original slice 859 module was a config-state stub: it stored
// `{mode, quality, enabled}` and exposed list/get ops, but no actual
// AA pass was ever wired into the renderer. Depth-push 2 (slice 917)
// upgrades it to a real EffectComposer chain that:
//
//   * builds an EffectComposer on the live viewport's WebGLRenderer
//     (sharing `vp.__studioComposer` with every other post-FX slice —
//     bloom, outline, SSGI, etc.) if one isn't already present;
//
//   * inserts an FXAA ShaderPass (three's FXAAShader, the FXAA 3.11
//     implementation that ships with three/examples/jsm/shaders) OR
//     an SMAAPass (full 3-stage edges/weights/blend post-process) OR
//     a TAARenderPass (replaces the RenderPass, accumulating up to 32
//     jittered samples) depending on the active mode;
//
//   * swaps the active pass cleanly when the user calls
//     `__studioAAEnable({ mode })` — the previous pass is removed and
//     disposed before the new one slots in;
//
//   * resizes the FXAA resolution uniform + SMAA / TAA pass sizes as
//     the canvas resizes (handled lazily on every enable + on a
//     viewport tick callback so it stays correct without continuous
//     polling);
//
//   * coexists with the slice 752 render-on-demand loop in Viewport3D:
//     that loop already prefers `composer.render()` over
//     `renderer.render(scene, camera)` whenever `vp.__studioComposer`
//     is set, so wiring our composer is sufficient — we additionally
//     call `__studioInvalidate()` after every state change to make
//     sure a frame is drawn even from an idle viewport.
//
// Public window ops (signatures preserved from slice 859 stub):
//
//   __studioAAEnable({ on, mode, quality })
//      Switches AA on/off and, when on, ensures the active pass is the
//      one named by `mode`. `quality` is honoured per-mode:
//        - FXAA: maps low/medium/high/ultra to internal sub-pixel
//          quality (resolution scale 0.5 / 1.0 / dpr / 2*dpr).
//        - SMAA: SMAA's three.js pass has a fixed quality (SMAA 1x);
//          we record the request but only adjust the size multiplier
//          on 'ultra'.
//        - TAA: sampleLevel mapped low=0 → 1 sample, medium=2 → 4
//          samples, high=3 → 8 samples, ultra=5 → 32 samples.
//
//   __studioAAListModes()    → { modes, qualities }
//   __studioAAGetStats()     → live state + canvas + pass info
//
// All three remain idempotent / safe-to-call from cold-start. If no
// viewport is mounted yet we keep the state but return ok:false on
// enable so the caller knows the pass didn't materialise. Re-calling
// __studioAAEnable once the viewport is up brings it online.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { TAARenderPass } from 'three/examples/jsm/postprocessing/TAARenderPass.js';

import { registerOps } from '../common/registry.js';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';

const MODES = ['none', 'fxaa', 'smaa', 'taa'];
const QUALITIES = ['low', 'medium', 'high', 'ultra'];

// FXAA quality → resolution multiplier (multiplied with renderer DPR).
const _FXAA_QUALITY = { low: 0.5, medium: 1.0, high: 1.0, ultra: 2.0 };
// TAA sampleLevel mapping. Pow(2, level) samples per frame; 5 = 32 samples.
const _TAA_SAMPLE_LEVEL = { low: 0, medium: 2, high: 3, ultra: 5 };

const _ctx = {
  installed: false,
  enabled: false,
  mode: 'fxaa',
  quality: 'medium',
  // Owned composer (only torn down when nothing else uses it).
  composer: null,
  ownsComposer: false,
  // Active AA pass + its kind ('fxaa' / 'smaa' / 'taa').
  pass: null,
  passKind: null,
  // For TAA mode we also need to swap out the host RenderPass.
  savedRenderPass: null,
  tickInstalled: false,
  // Stats counters
  frames: 0,
};

function _vp() { return (typeof window !== 'undefined') ? window.__archdiscViewport : null; }
function _renderer() { const v = _vp(); return v && v.renderer; }
function _scene() { const v = _vp(); return (v && v.scene) || (typeof window !== 'undefined' ? window.__archdiscScene : null); }
function _camera() { const v = _vp(); return v && v.camera; }
function _composer() { const v = _vp(); return v && v.__studioComposer; }

function _canvasSize() {
  const r = _renderer();
  if (!r || !r.domElement) return { w: 1, h: 1, dpr: 1 };
  const w = Math.max(1, Math.floor(r.domElement.clientWidth || r.domElement.width || 1));
  const h = Math.max(1, Math.floor(r.domElement.clientHeight || r.domElement.height || 1));
  let dpr = 1;
  try { dpr = r.getPixelRatio() || 1; } catch (_) {}
  return { w, h, dpr };
}

function _invalidate() {
  if (typeof window !== 'undefined' && typeof window.__studioInvalidate === 'function') {
    try { window.__studioInvalidate(); } catch (_) {}
  }
}

// Ensure the viewport has an EffectComposer. If one exists already
// (created by outline / bloom / SSGI / SSR etc.), reuse it. Otherwise
// build a barebones RenderPass + OutputPass composer and remember
// that we own it so _maybeDisposeComposer can tear it back down once
// nothing else is using it.
function _ensureComposer() {
  const v = _vp();
  if (!v) return null;
  if (v.__studioComposer) {
    _ctx.composer = v.__studioComposer;
    return _ctx.composer;
  }
  const r = _renderer();
  const s = _scene();
  const c = _camera();
  if (!r || !s || !c) return null;
  const composer = new EffectComposer(r);
  composer.addPass(new RenderPass(s, c));
  composer.addPass(new OutputPass());
  const { w, h } = _canvasSize();
  composer.setSize(w, h);
  v.__studioComposer = composer;
  _ctx.composer = composer;
  _ctx.ownsComposer = true;
  return composer;
}

// Insert a pass just before the terminal pass (OutputPass) so the
// FXAA / SMAA pass writes through the gamma / tone pipeline correctly.
function _insertBeforeOutput(composer, pass) {
  if (!composer || !pass) return;
  const passes = composer.passes || [];
  // Find the last OutputPass-like terminal pass and insert before it.
  let idx = passes.length;
  for (let i = passes.length - 1; i >= 0; i--) {
    const cn = passes[i] && passes[i].constructor && passes[i].constructor.name;
    if (cn === 'OutputPass' || cn === 'ToneMappingPass') { idx = i; break; }
  }
  composer.insertPass(pass, idx);
}

// Remove + dispose the current AA pass and restore any RenderPass we
// might have swapped out for TAA mode.
function _removeActivePass() {
  const composer = _ctx.composer || _composer();
  if (composer && _ctx.pass) {
    try { composer.removePass(_ctx.pass); } catch (_) {}
    try { _ctx.pass.dispose && _ctx.pass.dispose(); } catch (_) {}
  }
  // Restore the saved RenderPass we displaced when entering TAA mode.
  if (_ctx.passKind === 'taa' && composer && _ctx.savedRenderPass) {
    // Put the RenderPass back at the head of the chain.
    composer.insertPass(_ctx.savedRenderPass, 0);
    _ctx.savedRenderPass = null;
  }
  _ctx.pass = null;
  _ctx.passKind = null;
}

function _makeFXAAPass() {
  const pass = new ShaderPass(FXAAShader);
  pass.__archdiscAAKind = 'fxaa';
  _applyFXAAResolution(pass);
  return pass;
}

function _applyFXAAResolution(pass) {
  if (!pass || !pass.material || !pass.material.uniforms || !pass.material.uniforms.resolution) return;
  const { w, h, dpr } = _canvasSize();
  const mul = _FXAA_QUALITY[_ctx.quality] || 1.0;
  // resolution uniform expects 1/width, 1/height in physical px. The
  // quality multiplier scales the effective DPR so 'low' gives a
  // coarser pass (faster, blurrier edges) and 'ultra' a finer one.
  const px = Math.max(1, w * dpr * mul);
  const py = Math.max(1, h * dpr * mul);
  pass.material.uniforms.resolution.value.set(1 / px, 1 / py);
}

function _makeSMAAPass() {
  const { w, h, dpr } = _canvasSize();
  const mul = (_ctx.quality === 'ultra') ? 2 : 1;
  const pass = new SMAAPass();
  // SMAAPass's constructor signature in three 0.181 takes no args; size
  // is applied via setSize. Apply the canvas dimensions × DPR × quality.
  try { pass.setSize(Math.max(1, w * dpr * mul), Math.max(1, h * dpr * mul)); } catch (_) {}
  pass.__archdiscAAKind = 'smaa';
  return pass;
}

function _makeTAAPass() {
  const s = _scene(); const c = _camera();
  if (!s || !c) return null;
  const pass = new TAARenderPass(s, c);
  pass.sampleLevel = _TAA_SAMPLE_LEVEL[_ctx.quality] != null
    ? _TAA_SAMPLE_LEVEL[_ctx.quality]
    : 2;
  // TAA accumulates only when the scene is static; the camera/scene
  // changing resets the accumulation buffer (TAA does this internally
  // via .accumulate).
  pass.unbiased = true;
  pass.accumulate = false; // start fresh; will accumulate while idle
  pass.__archdiscAAKind = 'taa';
  return pass;
}

// Install a frame-tick callback so the FXAA resolution uniform / SMAA
// + TAA pass sizes stay in sync with the live canvas. Cheap: one
// comparison + (when changed) one uniform/setSize call per frame.
let _lastTickW = -1, _lastTickH = -1, _lastTickDpr = -1;
function _installTick() {
  if (_ctx.tickInstalled) return;
  const ok = chainIntoAnimTick('aafx', () => {
    _ctx.frames++;
    if (!_ctx.enabled || !_ctx.pass) return;
    const { w, h, dpr } = _canvasSize();
    if (w === _lastTickW && h === _lastTickH && dpr === _lastTickDpr) return;
    _lastTickW = w; _lastTickH = h; _lastTickDpr = dpr;
    try {
      if (_ctx.passKind === 'fxaa') _applyFXAAResolution(_ctx.pass);
      else if (_ctx.passKind === 'smaa') {
        const mul = (_ctx.quality === 'ultra') ? 2 : 1;
        _ctx.pass.setSize(Math.max(1, w * dpr * mul), Math.max(1, h * dpr * mul));
      } else if (_ctx.passKind === 'taa') {
        _ctx.pass.setSize(Math.max(1, w), Math.max(1, h));
      }
      if (_ctx.composer) _ctx.composer.setSize(w, h);
    } catch (_) {}
  });
  if (ok && ok.ok) _ctx.tickInstalled = true;
}

function _uninstallTick() {
  if (!_ctx.tickInstalled) return;
  unchainFromAnimTick('aafx');
  _ctx.tickInstalled = false;
}

// Build + insert the pass for the current `_ctx.mode`. Idempotent:
// removes any prior active pass before inserting the new one. Mode
// 'none' just removes — leaves the composer alone so other slices'
// passes keep working.
function _installActivePass() {
  _removeActivePass();
  if (_ctx.mode === 'none') return { ok: true, kind: 'none' };
  const composer = _ensureComposer();
  if (!composer) return { ok: false, error: 'no composer' };

  let pass = null;
  if (_ctx.mode === 'fxaa') {
    pass = _makeFXAAPass();
    _insertBeforeOutput(composer, pass);
  } else if (_ctx.mode === 'smaa') {
    pass = _makeSMAAPass();
    _insertBeforeOutput(composer, pass);
  } else if (_ctx.mode === 'taa') {
    pass = _makeTAAPass();
    if (!pass) return { ok: false, error: 'no scene/camera for TAA' };
    // TAA replaces the RenderPass at the head of the chain because it
    // is itself a render pass (jitters camera + accumulates samples).
    // Save the displaced RenderPass so 'none' / mode-switch restores it.
    const passes = composer.passes || [];
    const renderIdx = passes.findIndex((p) => p && p.constructor && p.constructor.name === 'RenderPass');
    if (renderIdx >= 0) {
      _ctx.savedRenderPass = passes[renderIdx];
      try { composer.removePass(_ctx.savedRenderPass); } catch (_) {}
    }
    composer.insertPass(pass, 0);
  }
  _ctx.pass = pass;
  _ctx.passKind = _ctx.mode;
  _installTick();
  _invalidate();
  return { ok: true, kind: _ctx.passKind };
}

// If we own the composer + nothing else uses it (only RenderPass +
// OutputPass remain), tear it down so the cheap raw-renderer path
// resumes.
function _maybeDisposeComposer() {
  if (!_ctx.ownsComposer || !_ctx.composer) return;
  const passes = _ctx.composer.passes || [];
  // Filter out passes that are 'ours' (none right now — we already
  // removed) and the terminal RenderPass + OutputPass which we created.
  const remaining = passes.filter((p) => {
    if (!p) return false;
    const cn = p.constructor && p.constructor.name;
    if (cn === 'RenderPass' || cn === 'OutputPass') return false;
    return true;
  });
  if (remaining.length > 0) return; // someone else still uses it
  try { _ctx.composer.dispose && _ctx.composer.dispose(); } catch (_) {}
  const v = _vp();
  if (v && v.__studioComposer === _ctx.composer) v.__studioComposer = null;
  _ctx.composer = null;
  _ctx.ownsComposer = false;
}

let _installed = false;
let _state = { mode: 'fxaa', quality: 'medium', enabled: false };

export function installFXAASMAA() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  _ctx.installed = true;

  const ops = {
    __studioAAEnable: ({ on, mode, quality } = {}) => {
      let modeChanged = false;
      let onChanged = false;
      let qualityChanged = false;
      if (mode != null && MODES.includes(mode)) {
        modeChanged = mode !== _ctx.mode;
        _ctx.mode = mode;
      }
      if (quality != null && QUALITIES.includes(quality)) {
        qualityChanged = quality !== _ctx.quality;
        _ctx.quality = quality;
      }
      if (on != null) {
        const next = !!on;
        onChanged = next !== _ctx.enabled;
        _ctx.enabled = next;
      }
      // Mirror to the public state struct for back-compat.
      _state.mode = _ctx.mode;
      _state.quality = _ctx.quality;
      _state.enabled = _ctx.enabled;

      // Decide what to actually wire. If the user disabled AA entirely
      // OR set mode='none', drop the active pass. Otherwise (re)install
      // the pass for the requested mode.
      let result;
      if (!_ctx.enabled || _ctx.mode === 'none') {
        _removeActivePass();
        _uninstallTick();
        _maybeDisposeComposer();
        _invalidate();
        result = { ok: true, kind: 'none', applied: 'off' };
      } else if (modeChanged || qualityChanged || onChanged || !_ctx.pass) {
        result = _installActivePass();
        result.applied = 'on';
      } else {
        result = { ok: true, kind: _ctx.passKind, applied: 'unchanged' };
      }
      return {
        ...result,
        enabled: _ctx.enabled,
        mode: _ctx.mode,
        quality: _ctx.quality,
      };
    },

    __studioAAListModes: () => ({
      ok: true,
      modes: MODES.slice(),
      qualities: QUALITIES.slice(),
    }),

    __studioAAGetStats: () => {
      const { w, h, dpr } = _canvasSize();
      return {
        ok: true,
        enabled: _ctx.enabled,
        mode: _ctx.mode,
        quality: _ctx.quality,
        passKind: _ctx.passKind,
        hasPass: !!_ctx.pass,
        hasComposer: !!(_ctx.composer || _composer()),
        ownsComposer: !!_ctx.ownsComposer,
        composerPassCount: (_ctx.composer && _ctx.composer.passes) ? _ctx.composer.passes.length : 0,
        canvasW: w,
        canvasH: h,
        dpr,
        frames: _ctx.frames,
        // sampleLevel only meaningful for TAA.
        taaSampleLevel: (_ctx.passKind === 'taa' && _ctx.pass) ? _ctx.pass.sampleLevel : null,
      };
    },
  };

  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'FXAA / SMAA / TAA anti-aliasing');
  return { ok: true };
}

// Test/debug surface — same shape other v3 modules expose.
export const __internals__ = { _ctx, MODES, QUALITIES };

export default installFXAASMAA;
