// ArchDisc Studio V3 — MoGraph Fields.
//
// Cinema 4D / Houdini-style spatial weight fields. Each `create*` op
// returns a uuid (a stable string handle) and registers a callable
// weight function `(clonePos) -> w in [0,1]` on the module-level
// _fields registry. Effectors with a bound field multiply their
// per-instance delta by w; an absent field (or a field whose weight
// is 1) yields the effector's full contribution unchanged.
//
// The three field flavours mirror C4D's most-used Field types:
//   • Sphere — radial falloff (1 at centre → 0 at radius edge).
//   • Box    — axis-aligned bbox (1 inside → 0 outside; smooth at faces).
//   • Random — deterministic mulberry32 hash of integerised clonePos.
//
// All fields are pure JS — they DO NOT add anything to the scene
// graph. Inspection helpers (`listFields`, `getField`, `removeField`)
// keep the registry observable from the command palette + tests.

import * as THREE from 'three';

const _fields = new Map(); // uuid -> { kind, params, weight(clonePos) }

let _seq = 0;
function makeUuid(kind) {
  _seq += 1;
  // Stable, human-readable handles. Tests can compare on prefix without
  // relying on THREE.MathUtils.generateUUID's RFC4122 format.
  return `archdisc-field-${kind}-${_seq.toString(36)}-${(Math.random() * 1e9 | 0).toString(36)}`;
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

// ─── Sphere ─────────────────────────────────────────────────────────────
export function createSphereField(centerXYZ, radius) {
  const c = (Array.isArray(centerXYZ) && centerXYZ.length === 3)
    ? new THREE.Vector3(centerXYZ[0], centerXYZ[1], centerXYZ[2])
    : new THREE.Vector3(0, 0, 0);
  const r = Number.isFinite(+radius) && +radius > 0 ? +radius : 1;
  const uuid = makeUuid('sphere');
  const weight = (clonePos) => {
    const p = Array.isArray(clonePos)
      ? new THREE.Vector3(clonePos[0], clonePos[1], clonePos[2])
      : (clonePos && clonePos.isVector3 ? clonePos : new THREE.Vector3());
    const d = p.distanceTo(c);
    if (d >= r) return 0;
    // Linear inner-to-edge falloff. Smooth enough for visible
    // weighting; cheaper than a cubic Hermite.
    return clamp01(1 - d / r);
  };
  _fields.set(uuid, { kind: 'sphere', params: { center: [c.x, c.y, c.z], radius: r }, weight });
  return { ok: true, uuid, kind: 'sphere', params: { center: [c.x, c.y, c.z], radius: r } };
}

// ─── Box ────────────────────────────────────────────────────────────────
export function createBoxField(minXYZ, maxXYZ) {
  const mn = Array.isArray(minXYZ) && minXYZ.length === 3
    ? new THREE.Vector3(minXYZ[0], minXYZ[1], minXYZ[2])
    : new THREE.Vector3(-1, -1, -1);
  const mx = Array.isArray(maxXYZ) && maxXYZ.length === 3
    ? new THREE.Vector3(maxXYZ[0], maxXYZ[1], maxXYZ[2])
    : new THREE.Vector3(1, 1, 1);
  // Auto-correct flipped bounds so callers don't get silent zero
  // weight everywhere.
  const lo = new THREE.Vector3(Math.min(mn.x, mx.x), Math.min(mn.y, mx.y), Math.min(mn.z, mx.z));
  const hi = new THREE.Vector3(Math.max(mn.x, mx.x), Math.max(mn.y, mx.y), Math.max(mn.z, mx.z));
  const half = new THREE.Vector3(
    (hi.x - lo.x) * 0.5,
    (hi.y - lo.y) * 0.5,
    (hi.z - lo.z) * 0.5,
  );
  const center = new THREE.Vector3(
    (hi.x + lo.x) * 0.5,
    (hi.y + lo.y) * 0.5,
    (hi.z + lo.z) * 0.5,
  );
  const uuid = makeUuid('box');
  const weight = (clonePos) => {
    const p = Array.isArray(clonePos)
      ? new THREE.Vector3(clonePos[0], clonePos[1], clonePos[2])
      : (clonePos && clonePos.isVector3 ? clonePos : new THREE.Vector3());
    // Per-axis Chebyshev-style normalised distance from the centre.
    const dx = Math.abs(p.x - center.x);
    const dy = Math.abs(p.y - center.y);
    const dz = Math.abs(p.z - center.z);
    if (dx > half.x || dy > half.y || dz > half.z) return 0;
    const wx = half.x > 0 ? 1 - dx / half.x : 1;
    const wy = half.y > 0 ? 1 - dy / half.y : 1;
    const wz = half.z > 0 ? 1 - dz / half.z : 1;
    // Multiplicative blend so values fade toward each face.
    return clamp01(wx * wy * wz);
  };
  _fields.set(uuid, {
    kind: 'box',
    params: { min: [lo.x, lo.y, lo.z], max: [hi.x, hi.y, hi.z] },
    weight,
  });
  return { ok: true, uuid, kind: 'box', params: { min: [lo.x, lo.y, lo.z], max: [hi.x, hi.y, hi.z] } };
}

// ─── Random ─────────────────────────────────────────────────────────────
// Deterministic mulberry32 PRNG seeded by both the field seed and a
// quantised clone position, so the same field returns the same weight
// at the same point on every call.
function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRandomField(seed) {
  const s = Number.isFinite(+seed) ? (+seed >>> 0) : ((Math.random() * 1e9) >>> 0);
  const uuid = makeUuid('random');
  // Quantise positions to a 0.01 grid so neighbouring clones get
  // nearby (but uncorrelated) weights — yields visually noisy fields
  // rather than a jittery one-sample-per-clone smear.
  const weight = (clonePos) => {
    const px = Array.isArray(clonePos) ? clonePos[0] : (clonePos && clonePos.x) || 0;
    const py = Array.isArray(clonePos) ? clonePos[1] : (clonePos && clonePos.y) || 0;
    const pz = Array.isArray(clonePos) ? clonePos[2] : (clonePos && clonePos.z) || 0;
    const qx = Math.round(px * 100) | 0;
    const qy = Math.round(py * 100) | 0;
    const qz = Math.round(pz * 100) | 0;
    // Combine the field seed and the quantised coords into one int.
    const k = (((s ^ (qx * 73856093)) ^ (qy * 19349663)) ^ (qz * 83492791)) >>> 0;
    return mulberry32(k)();
  };
  _fields.set(uuid, { kind: 'random', params: { seed: s }, weight });
  return { ok: true, uuid, kind: 'random', params: { seed: s } };
}

// ─── Lookup + introspection ─────────────────────────────────────────────
export function getField(uuid) {
  const f = _fields.get(uuid);
  if (!f) return null;
  return f;
}

export function listFields() {
  const fields = [];
  _fields.forEach((f, uuid) => {
    fields.push({ uuid, kind: f.kind, params: { ...f.params } });
  });
  return { ok: true, count: fields.length, fields };
}

export function removeField(uuid) {
  const had = _fields.delete(uuid);
  return { ok: true, removed: had };
}

// ─── Sample (test helper) ───────────────────────────────────────────────
export function sampleField(uuid, clonePos) {
  const f = _fields.get(uuid);
  if (!f) return { ok: false, error: 'unknown field' };
  return { ok: true, weight: f.weight(clonePos) };
}

// Reset the registry (used by hot-reload + tests).
export function _resetFields() {
  _fields.clear();
  _seq = 0;
}
