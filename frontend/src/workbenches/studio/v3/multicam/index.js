// ArchDisc Studio V3 — multi-camera setup + switcher (slice 879).
// Multiple PerspectiveCamera presets + active-camera switcher; useful for
// game cutscenes + cinematic shots.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
const _cams = new Map();
let _active = null;
function _create({ name, position = [0.15, 0.10, 0.15], target = [0, 0, 0], fov = 45 } = {}) {
  const cam = new THREE.PerspectiveCamera(fov, 16 / 9, 0.001, 10000);
  cam.position.set(...position);
  cam.lookAt(...target);
  _cams.set(name, { cam, target: target.slice() });
  return { ok: true, name };
}
function _activate({ name } = {}) {
  const entry = _cams.get(name); if (!entry) return { ok: false };
  const vp = window.__archdiscViewport; if (!vp) return { ok: false };
  vp.camera = entry.cam; _active = name; return { ok: true, active: name };
}
export function installMultiCam() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioMultiCamCreate: _create,
    __studioMultiCamActivate: _activate,
    __studioMultiCamList: () => ({ ok: true, names: [..._cams.keys()], active: _active }),
    __studioMultiCamRemove: ({ name } = {}) => { _cams.delete(name); if (_active === name) _active = null; return { ok: true }; },
    __studioMultiCamSetPosition: ({ name, position, target } = {}) => {
      const e = _cams.get(name); if (!e) return { ok: false };
      if (position) e.cam.position.set(...position);
      if (target) { e.target = target.slice(); e.cam.lookAt(...target); }
      return { ok: true };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'anim', 'Multi-camera setup + switcher');
  return { ok: true };
}
export default installMultiCam;
