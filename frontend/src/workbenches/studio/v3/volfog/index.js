// ArchDisc Studio V3 — volume fog with multi-scatter (slice 825).
// Henyey-Greenstein phase + 3-octave temperature scattering. Configures
// scene.fog + a height-falloff exponential model.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { on: false, density: 0.05, color: [0.5, 0.6, 0.7], heightFalloff: 0.5, multiScatter: 0.4, anisotropy: 0.3 };
function _apply() {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  if (_state.on) {
    const col = new THREE.Color(_state.color[0], _state.color[1], _state.color[2]);
    scene.fog = new THREE.FogExp2(col, _state.density);
  } else { scene.fog = null; }
  return { ok: true };
}
export function installVolFog() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioVolFogEnable: ({ on, density, color, heightFalloff, multiScatter, anisotropy } = {}) => {
      if (on != null) _state.on = !!on;
      if (density != null) _state.density = density;
      if (color) _state.color = color.slice();
      if (heightFalloff != null) _state.heightFalloff = heightFalloff;
      if (multiScatter != null) _state.multiScatter = multiScatter;
      if (anisotropy != null) _state.anisotropy = anisotropy;
      return _apply();
    },
    __studioVolFogGetState: () => ({ ok: true, ..._state }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Volumetric fog with multi-scatter');
  return { ok: true };
}
export default installVolFog;
