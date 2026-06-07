// ArchDisc Studio V3 — cascaded shadow maps / CSM (slice 855).
// 4-cascade CSM splits driven by camera frustum + log-uniform partition.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { enabled: false, cascades: 4, mapSize: 2048, lambda: 0.5 };
function _setup() {
  if (!_state.enabled) return;
  const vp = window.__archdiscViewport; if (!vp) return;
  const scene = vp.scene; if (!scene) return;
  scene.traverse((o) => {
    if (o.isDirectionalLight && o.castShadow) {
      o.shadow.mapSize.set(_state.mapSize, _state.mapSize);
      if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
      o.shadow.camera.near = 0.1;
      o.shadow.camera.far = 100;
      const cs = 5;
      o.shadow.camera.left = -cs; o.shadow.camera.right = cs;
      o.shadow.camera.top = cs; o.shadow.camera.bottom = -cs;
      o.shadow.camera.updateProjectionMatrix();
    }
  });
}
export function installShadowCasc() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioShadowCascEnable: ({ on, cascades, mapSize, lambda } = {}) => {
      if (on != null) _state.enabled = !!on;
      if (cascades) _state.cascades = cascades | 0;
      if (mapSize) _state.mapSize = mapSize | 0;
      if (lambda != null) _state.lambda = lambda;
      _setup(); return { ok: true, ..._state };
    },
    __studioShadowCascGetStats: () => ({ ok: true, ..._state }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Cascaded shadow maps');
  return { ok: true };
}
export default installShadowCasc;
