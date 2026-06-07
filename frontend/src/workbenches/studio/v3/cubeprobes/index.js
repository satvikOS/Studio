// ArchDisc Studio V3 — cube reflection probes (slice 908).
// Capture a CubeRenderTarget at a probe position, store cube texture, and
// assign as envMap on nearby materials.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
const _probes = new Map();
function _capture({ id, position = [0, 0, 0], size = 256 } = {}) {
  if (!id) id = `probe_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const vp = window.__archdiscViewport; if (!vp?.renderer || !vp.scene) return { ok: false };
  const cubeRT = new THREE.WebGLCubeRenderTarget(size);
  const cubeCam = new THREE.CubeCamera(0.01, 100, cubeRT);
  cubeCam.position.set(...position);
  vp.scene.add(cubeCam);
  cubeCam.update(vp.renderer, vp.scene);
  vp.scene.remove(cubeCam);
  _probes.set(id, { position, cubeRT, size });
  return { ok: true, id };
}
function _apply({ id, meshUuid } = {}) {
  const p = _probes.get(id); if (!p) return { ok: false };
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const m = scene.getObjectByProperty('uuid', meshUuid); if (!m?.material) return { ok: false };
  m.material.envMap = p.cubeRT.texture; m.material.needsUpdate = true;
  return { ok: true };
}
export function installCubeProbes() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioCubeProbeCapture: _capture,
    __studioCubeProbeApply: _apply,
    __studioCubeProbeList: () => ({ ok: true, ids: [..._probes.keys()] }),
    __studioCubeProbeRemove: ({ id } = {}) => {
      const p = _probes.get(id); if (p) p.cubeRT.dispose();
      _probes.delete(id); return { ok: true };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Cube reflection probes');
  return { ok: true };
}
export default installCubeProbes;
