// Slice 729 — Marvelous Designer real-time fitting. Continuously
// runs a slice-705 garment cloth solver against a "body" mesh,
// pushing garment verts out of body interior each tick. Lets the
// user pose / animate the body and see the garment update live.

import * as THREE from 'three';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';

const _fittings = new Map();
let _seq = 1;
function _uid() { return `mdf-${_seq++}-${Date.now().toString(36)}`; }

export function attach(garmentUuid, bodyUuid, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const g = scene.getObjectByProperty('uuid', garmentUuid);
  const b = scene.getObjectByProperty('uuid', bodyUuid);
  if (!g?.geometry || !b?.geometry) return { ok: false };
  const id = _uid();
  const f = {
    id, garmentUuid, bodyUuid,
    stepSize: Number(opts?.stepSize) || 0.005,
    gravity: Number(opts?.gravity) || -0.01,
    iterations: Math.max(1, Math.min(10, Number(opts?.iterations) || 3)),
    enabled: true,
  };
  _fittings.set(id, f);
  chainIntoAnimTick(`mdfit2_${id}`, () => _tick(f));
  return { ok: true, id };
}

function _tick(f) {
  if (!f.enabled) return;
  const scene = window.__archdiscScene;
  if (!scene) return;
  const garment = scene.getObjectByProperty('uuid', f.garmentUuid);
  const body = scene.getObjectByProperty('uuid', f.bodyUuid);
  if (!garment || !body) return;
  body.updateMatrixWorld(true);
  garment.updateMatrixWorld(true);
  const bodyBox = new THREE.Box3().setFromObject(body);
  const pos = garment.geometry.attributes.position;
  for (let iter = 0; iter < f.iterations; iter++) {
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.array[i * 3], pos.array[i * 3 + 1], pos.array[i * 3 + 2]).applyMatrix4(garment.matrixWorld);
      v.y += f.gravity;
      // Push out of body bbox: if v is inside, project outward along
      // (v - bodyCenter).
      if (bodyBox.containsPoint(v)) {
        const c = bodyBox.getCenter(new THREE.Vector3());
        const outward = v.clone().sub(c).normalize().multiplyScalar(0.01);
        v.add(outward);
      }
      // Write back in garment local space.
      const local = v.applyMatrix4(new THREE.Matrix4().copy(garment.matrixWorld).invert());
      pos.array[i * 3]     = local.x;
      pos.array[i * 3 + 1] = local.y;
      pos.array[i * 3 + 2] = local.z;
    }
    pos.needsUpdate = true;
  }
  garment.geometry.computeVertexNormals();
}

export function setEnabled(id, enabled) {
  const f = _fittings.get(id);
  if (!f) return { ok: false };
  f.enabled = !!enabled;
  return { ok: true };
}

export function setGravity(id, gravity) {
  const f = _fittings.get(id);
  if (!f) return { ok: false };
  f.gravity = Number(gravity);
  return { ok: true };
}

export function detach(id) {
  const f = _fittings.get(id);
  if (!f) return { ok: false };
  unchainFromAnimTick(`mdfit2_${id}`);
  _fittings.delete(id);
  return { ok: true };
}

export function listFittings() {
  return {
    ok: true,
    fittings: Array.from(_fittings.values()).map((f) => ({
      id: f.id, garmentUuid: f.garmentUuid, bodyUuid: f.bodyUuid,
      iterations: f.iterations, enabled: f.enabled,
    })),
  };
}
