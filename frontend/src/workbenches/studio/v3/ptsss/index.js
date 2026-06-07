// ArchDisc Studio V3 — subsurface scattering in path tracer.
//
// Slice 832 shipped a config-only stub. Slice 885 replaced it with the
// real random-walk BSSRDF in ./bssrdf.js. This module is the seam
// between slice 784's CPU path tracer and the BSSRDF kernel:
//   - holds the runtime enable/maxBounces/preset state,
//   - exposes the __studioPTSSS* ops to the command palette,
//   - re-exports sampleBSSRDF / SSS_PRESETS so the path tracer can
//     import a single barrel.

import { registerOps } from '../common/registry.js';
import {
  sampleBSSRDF,
  henyeyGreensteinPhase,
  hasBSSRDF,
  SSS_PRESETS,
} from './bssrdf.js';

let _installed = false;
let _state = {
  enabled: true,
  mode: 'random-walk',
  maxBounces: 6,
  scatterDistance: 0.005,
  preset: 'skin_light',
  walks: 0,    // running counter of subsurface walks taken
  exits: 0,    // walks that found a real exit before bounce cap
};

// Bumped by the path tracer when a walk runs.
export function _recordWalk(exited) {
  _state.walks++;
  if (exited) _state.exits++;
}

// Helpers used by slice 784 — checks runtime enable + delegates to the
// BSSRDF kernel.
export function shouldDoBSSRDF(mat) {
  if (!_state.enabled) return false;
  return hasBSSRDF(mat);
}

export function runBSSRDFWalk(hit, occluders, rngFn) {
  const res = sampleBSSRDF(hit, occluders, rngFn);
  if (res && res.ok) _recordWalk(!!res.exited);
  return res;
}

export { sampleBSSRDF, henyeyGreensteinPhase, hasBSSRDF, SSS_PRESETS };

export function installPTSSS() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioPTSSSEnable: ({ on, mode, maxBounces, scatterDistance, preset } = {}) => {
      if (on != null) _state.enabled = !!on;
      if (mode) _state.mode = mode;
      if (maxBounces) _state.maxBounces = maxBounces | 0;
      if (scatterDistance != null) _state.scatterDistance = scatterDistance;
      if (preset && SSS_PRESETS[preset]) _state.preset = preset;
      return { ok: true, ..._state };
    },
    __studioPTSSSGetStats: () => ({ ok: true, ..._state, presets: Object.keys(SSS_PRESETS) }),
    __studioPTSSSListPresets: () => ({ ok: true, presets: Object.keys(SSS_PRESETS), table: SSS_PRESETS }),
    // Tag a mesh's material so the path tracer treats it as subsurface.
    // Accepts { uuid, preset? } or { meshName, preset? }.
    __studioPTSSSTagMaterial: ({ uuid, meshName, preset } = {}) => {
      try {
        if (typeof window === 'undefined') return { ok: false, error: 'no window' };
        const vp = window.__archdiscViewport;
        if (!vp || !vp.scene) return { ok: false, error: 'no viewport' };
        let target = null;
        vp.scene.traverse((o) => {
          if (target) return;
          if (uuid && o.uuid === uuid) target = o;
          else if (meshName && o.name === meshName) target = o;
        });
        if (!target || !target.material) return { ok: false, error: 'no target mesh/material' };
        const mat = target.material;
        mat.userData = mat.userData || {};
        mat.userData.archdiscStudioSkinSSS = true;
        if (preset && SSS_PRESETS[preset]) {
          mat.userData.bssrdfPreset = preset;
        }
        return { ok: true, uuid: target.uuid, preset: preset || _state.preset };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'render', 'Subsurface scattering in path tracer');
  return { ok: true };
}

export default installPTSSS;
