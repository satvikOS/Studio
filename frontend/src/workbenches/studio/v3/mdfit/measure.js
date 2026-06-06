// Slice 712 — Marvelous Designer measurement + fit testing. Add
// virtual measurement tapes along a garment + a body mesh; computes
// circumference at hip/waist/bust planes and reports tightness
// (garment ⌀ - body ⌀) per measurement. Mirrors MD's measurement
// tape + fit map.

import * as THREE from 'three';

const _measurements = new Map();   // id → { meshUuid, planeY, circumference, label }
let _seq = 1;
function _uid() { return `mm-${_seq++}-${Date.now().toString(36)}`; }

function _circumferenceAtY(meshUuid, y) {
  const scene = window.__archdiscScene;
  if (!scene) return null;
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry?.attributes?.position) return null;
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.attributes.position;
  const idx = mesh.geometry.index?.array;
  const triCount = idx ? idx.length / 3 : pos.count / 3;
  const segments = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3] : t * 3;
    const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const v = [i0, i1, i2].map((i) => {
      const x = pos.array[i * 3], yy = pos.array[i * 3 + 1], z = pos.array[i * 3 + 2];
      const w = new THREE.Vector3(x, yy, z).applyMatrix4(mesh.matrixWorld);
      return [w.x, w.y, w.z];
    });
    const eds = [[0, 1], [1, 2], [2, 0]];
    const cuts = [];
    for (const [a, b] of eds) {
      if ((v[a][1] - y) * (v[b][1] - y) < 0) {
        const t2 = (y - v[a][1]) / (v[b][1] - v[a][1]);
        cuts.push([v[a][0] + t2 * (v[b][0] - v[a][0]), v[a][2] + t2 * (v[b][2] - v[a][2])]);
      }
    }
    if (cuts.length === 2) segments.push(cuts);
  }
  // Walk segments to form a closed polygon — for simplicity, sum segment lengths.
  let len = 0;
  for (const seg of segments) {
    const dx = seg[1][0] - seg[0][0], dz = seg[1][1] - seg[0][1];
    len += Math.sqrt(dx * dx + dz * dz);
  }
  return len;
}

export function addMeasurement(label, meshUuid, planeY) {
  const id = _uid();
  const c = _circumferenceAtY(meshUuid, planeY);
  if (c === null) return { ok: false };
  _measurements.set(id, { id, label, meshUuid, planeY, circumference: c });
  return { ok: true, id, circumference: c };
}

export function refresh(id) {
  const m = _measurements.get(id);
  if (!m) return { ok: false };
  m.circumference = _circumferenceAtY(m.meshUuid, m.planeY);
  return { ok: true, circumference: m.circumference };
}

export function getFitMap(garmentUuid, bodyUuid, levels) {
  // Compute tightness = (garment - body) at each level.
  const out = [];
  for (const level of (levels || [])) {
    const g = _circumferenceAtY(garmentUuid, level.y);
    const b = _circumferenceAtY(bodyUuid, level.y);
    if (g === null || b === null) continue;
    const tightness = g - b;
    out.push({
      label: level.label,
      y: level.y,
      garment: g, body: b,
      tightness,
      classification: tightness < -0.02 ? 'tight' : tightness > 0.1 ? 'loose' : 'snug',
    });
  }
  return { ok: true, levels: out };
}

export function getStandardLevels(bodyUuid) {
  // Hip/waist/bust based on body bbox heights.
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const body = scene.getObjectByProperty('uuid', bodyUuid);
  if (!body) return { ok: false };
  const box = new THREE.Box3().setFromObject(body);
  const h = box.max.y - box.min.y;
  return {
    ok: true,
    levels: [
      { label: 'bust',  y: box.min.y + h * 0.78 },
      { label: 'waist', y: box.min.y + h * 0.62 },
      { label: 'hip',   y: box.min.y + h * 0.50 },
      { label: 'thigh', y: box.min.y + h * 0.36 },
      { label: 'knee',  y: box.min.y + h * 0.22 },
    ],
  };
}

export function removeMeasurement(id) {
  return { ok: _measurements.delete(id) };
}

export function listMeasurements() {
  return {
    ok: true,
    measurements: Array.from(_measurements.values()).map((m) => ({
      id: m.id, label: m.label, meshUuid: m.meshUuid, planeY: m.planeY, circumference: m.circumference,
    })),
  };
}
