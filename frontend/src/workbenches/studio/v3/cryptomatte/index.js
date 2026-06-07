// ArchDisc Studio V3 — cryptomatte / render layers (slice 872).
// Per-object ID masks for compositing. Hashes object name → unique
// color, renders an ID pass that comp can pick from.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
function _hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return h >>> 0;
}
function _render({ width = 512, height = 384, includeMaterial = false } = {}) {
  const vp = window.__archdiscViewport; if (!vp) return { ok: false };
  const { scene, camera, renderer } = vp;
  if (!scene || !camera || !renderer) return { ok: false };
  const idMap = new Map(); // uuid → color
  const overrides = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const seed = includeMaterial ? (o.name + '/' + (o.material?.name || '')) : (o.name || o.uuid);
    const h = _hash(seed);
    const color = new THREE.Color(((h >> 16) & 0xff) / 255, ((h >> 8) & 0xff) / 255, (h & 0xff) / 255);
    idMap.set(o.uuid, color.getHexString());
    overrides.push({ obj: o, prev: o.material });
    o.material = new THREE.MeshBasicMaterial({ color });
  });
  const target = new THREE.WebGLRenderTarget(width, height);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  for (const ov of overrides) ov.obj.material = ov.prev;
  return { ok: true, idMap: Object.fromEntries(idMap), width, height };
}
export function installCryptomatte() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioCryptomatteRender: _render,
    __studioCryptomatteLookup: ({ uuid } = {}) => {
      const seed = uuid;
      const h = _hash(seed);
      return { ok: true, color: ((h >> 16) & 0xff << 16) | ((h >> 8) & 0xff << 8) | (h & 0xff) };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'render', 'Cryptomatte / render-layer ID pass');
  return { ok: true };
}
export default installCryptomatte;
