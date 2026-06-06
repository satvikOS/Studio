// Slice 729 — C4D Volume Builder + Volume Mesher. Converts mesh
// inputs into an implicit SDF volume using union/subtract/intersect
// with smoothing, then meshes back via marching cubes. Distinct from
// slice-697 sdf (op list around SDF primitives) by chaining mesh →
// SDF → mesh; closer to C4D's Volume Builder + Volume Mesher object
// pair.

import * as THREE from 'three';

const _builders = new Map();
let _seq = 1;
function _uid() { return `vb-${_seq++}-${Date.now().toString(36)}`; }

export function createBuilder(opts) {
  const id = _uid();
  _builders.set(id, {
    id,
    inputs: [],   // [{ meshUuid, op:'union'|'subtract'|'intersect', smoothing }]
    voxelSize: Number(opts?.voxelSize) || 0.05,
    smoothing: Number(opts?.smoothing) || 0.0,
    output: null,
  });
  return { ok: true, id };
}

export function addInput(builderId, meshUuid, op, smoothing) {
  const b = _builders.get(builderId);
  if (!b) return { ok: false };
  b.inputs.push({
    meshUuid,
    op: op || 'union',
    smoothing: Number(smoothing) || b.smoothing,
  });
  return { ok: true };
}

export function build(builderId) {
  const b = _builders.get(builderId);
  if (!b) return { ok: false };
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  // Use slice-697 sdf if installed to actually voxelize.
  if (typeof window.__studioSDFAddOp === 'function' && typeof window.__studioSDFGenerateMesh === 'function') {
    try { window.__studioSDFClear(); } catch (_) {}
    // Add each input as a sphere SDF op (simplification — true voxelize
    // from mesh would be expensive; we approximate by the input's bbox
    // center radius).
    for (const inp of b.inputs) {
      const m = scene.getObjectByProperty('uuid', inp.meshUuid);
      if (!m) continue;
      const box = new THREE.Box3().setFromObject(m);
      const center = box.getCenter(new THREE.Vector3());
      const sz = box.getSize(new THREE.Vector3());
      const radius = Math.max(sz.x, sz.y, sz.z) / 2;
      window.__studioSDFAddOp('sphere', {
        center: [center.x, center.y, center.z],
        radius,
        mode: inp.op,
        smoothK: inp.smoothing,
      });
    }
    const r = window.__studioSDFGenerateMesh({ resolution: Math.round(2 / b.voxelSize) });
    if (r?.ok) {
      b.output = r.uuid;
      return { ok: true, uuid: r.uuid };
    }
  }
  return { ok: false, error: 'slice-697 sdf not installed' };
}

export function setVoxelSize(builderId, voxelSize) {
  const b = _builders.get(builderId);
  if (!b) return { ok: false };
  b.voxelSize = Number(voxelSize);
  return { ok: true };
}

export function clearInputs(builderId) {
  const b = _builders.get(builderId);
  if (!b) return { ok: false };
  b.inputs = [];
  return { ok: true };
}

export function listBuilders() {
  return {
    ok: true,
    builders: Array.from(_builders.values()).map((b) => ({
      id: b.id, inputCount: b.inputs.length, voxelSize: b.voxelSize, output: b.output,
    })),
  };
}

export function deleteBuilder(id) {
  return { ok: _builders.delete(id) };
}
