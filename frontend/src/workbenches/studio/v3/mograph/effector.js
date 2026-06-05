// ArchDisc Studio V3 — MoGraph Effectors.
//
// Modulate the per-instance transforms of a cloner-emitted
// InstancedMesh. Every effector re-bases off the cloner's cached
// `baseMatrices` snapshot so re-running an effector replays from the
// original layout instead of compounding on top of the previous run.
//
// Effectors bound to a field call `field.weight(clonePos)` per clone
// and multiply their delta (position/rotation/scale) by that weight.
// Unbound effectors run at full strength (weight = 1).
//
//   __studioEffectorRandom(clonerUuid, posJitter, rotJitter, scaleJitter)
//   __studioEffectorPlain(clonerUuid, positionXYZ, rotationXYZ, scaleXYZ)
//   __studioEffectorStep(clonerUuid, perStep)
//   __studioEffectorBindField(effectorUuid, fieldUuid)
//
// `bindField` mutates the cloner.userData.fieldUuid AND stores the
// last-used effector spec on userData.archdiscStudioEffector so a
// re-bind followed by a re-run uses the new field. Each apply call
// returns { ok, effectorUuid, clonerUuid, kind, count }.

import * as THREE from 'three';
import { findClonerByUuid } from './cloner.js';
import { getField } from './field.js';
import { mulberry32, fnv1a32 as hashString } from '../common/random.js';

// Map of effectorUuid -> { kind, clonerUuid, params, fieldUuid }.
// Maintained so a re-apply (via __studioEffectorBindField + a fresh
// call) knows which params to replay.
const _effectors = new Map();

let _seq = 0;
function makeEffectorUuid(kind) {
  _seq += 1;
  return `archdisc-effector-${kind}-${_seq.toString(36)}-${(Math.random() * 1e9 | 0).toString(36)}`;
}

// Build a fresh Matrix4 from a flat 16-element array.
function matFromArray(arr) {
  const m = new THREE.Matrix4();
  m.fromArray(arr);
  return m;
}

// Deterministic per-instance mulberry32 (seeded with cloner uuid hash
// + instance index) so a "random" effector replays identically when
// re-applied. Avoids the C4D footgun where re-running random keeps
// shuffling clones around forever.
// hashString + mulberry32 imported from common/random.js.

// ─── Core apply loop ────────────────────────────────────────────────────
// `deltaFn` returns { dPos: Vector3, dRot: Vector3 (euler), dScl: Vector3 }
// for instance index i with base position `basePos`. The caller is
// responsible for branching on the effector kind.
function applyToCloner(cloner, deltaFn) {
  const userData = cloner.userData.archdiscStudioCloner;
  const base = userData.baseMatrices;
  const N = base.length;
  const field = userData.fieldUuid ? getField(userData.fieldUuid) : null;
  const m = new THREE.Matrix4();
  const baseM = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const euler = new THREE.Euler();
  for (let i = 0; i < N; i++) {
    baseM.fromArray(base[i]);
    baseM.decompose(pos, quat, scl);
    const w = field ? field.weight([pos.x, pos.y, pos.z]) : 1;
    const d = deltaFn(i, pos);
    pos.x += d.dPos.x * w;
    pos.y += d.dPos.y * w;
    pos.z += d.dPos.z * w;
    if (d.dRot.x || d.dRot.y || d.dRot.z) {
      euler.setFromQuaternion(quat, 'XYZ');
      euler.x += d.dRot.x * w;
      euler.y += d.dRot.y * w;
      euler.z += d.dRot.z * w;
      quat.setFromEuler(euler);
    }
    // Scale uses 1 + weighted-delta so passing 0 leaves scale unchanged.
    const sx = scl.x * (1 + d.dScl.x * w);
    const sy = scl.y * (1 + d.dScl.y * w);
    const sz = scl.z * (1 + d.dScl.z * w);
    scl.set(sx, sy, sz);
    m.compose(pos, quat, scl);
    cloner.setMatrixAt(i, m);
  }
  cloner.instanceMatrix.needsUpdate = true;
  return N;
}

// ─── Random ─────────────────────────────────────────────────────────────
export function effectorRandom(clonerUuid, posJitter, rotJitter, scaleJitter) {
  const cloner = findClonerByUuid(clonerUuid);
  if (!cloner) return { ok: false, error: 'no cloner by uuid' };
  const pj = Number.isFinite(+posJitter) ? +posJitter : 0;
  const rj = Number.isFinite(+rotJitter) ? +rotJitter : 0;
  const sj = Number.isFinite(+scaleJitter) ? +scaleJitter : 0;
  const seed = hashString(`${clonerUuid}|random|${pj}|${rj}|${sj}`);
  // One RNG seeded per index so each instance gets a unique stream
  // even when params re-hash to the same root seed.
  const N = applyToCloner(cloner, (i) => {
    const rng = mulberry32(seed + i * 2654435761);
    return {
      dPos: new THREE.Vector3((rng() * 2 - 1) * pj, (rng() * 2 - 1) * pj, (rng() * 2 - 1) * pj),
      dRot: new THREE.Vector3((rng() * 2 - 1) * rj, (rng() * 2 - 1) * rj, (rng() * 2 - 1) * rj),
      dScl: new THREE.Vector3((rng() * 2 - 1) * sj, (rng() * 2 - 1) * sj, (rng() * 2 - 1) * sj),
    };
  });
  const uuid = makeEffectorUuid('random');
  _effectors.set(uuid, {
    kind: 'random', clonerUuid, params: { posJitter: pj, rotJitter: rj, scaleJitter: sj },
    fieldUuid: cloner.userData.archdiscStudioCloner.fieldUuid || null,
  });
  return { ok: true, effectorUuid: uuid, clonerUuid, kind: 'random', count: N };
}

// ─── Plain ──────────────────────────────────────────────────────────────
export function effectorPlain(clonerUuid, positionXYZ, rotationXYZ, scaleXYZ) {
  const cloner = findClonerByUuid(clonerUuid);
  if (!cloner) return { ok: false, error: 'no cloner by uuid' };
  const p = Array.isArray(positionXYZ) ? positionXYZ : [0, 0, 0];
  const r = Array.isArray(rotationXYZ) ? rotationXYZ : [0, 0, 0];
  const s = Array.isArray(scaleXYZ) ? scaleXYZ : [0, 0, 0];
  const dPos = new THREE.Vector3(+p[0] || 0, +p[1] || 0, +p[2] || 0);
  const dRot = new THREE.Vector3(+r[0] || 0, +r[1] || 0, +r[2] || 0);
  const dScl = new THREE.Vector3(+s[0] || 0, +s[1] || 0, +s[2] || 0);
  const N = applyToCloner(cloner, () => ({ dPos, dRot, dScl }));
  const uuid = makeEffectorUuid('plain');
  _effectors.set(uuid, {
    kind: 'plain', clonerUuid,
    params: { position: [dPos.x, dPos.y, dPos.z], rotation: [dRot.x, dRot.y, dRot.z], scale: [dScl.x, dScl.y, dScl.z] },
    fieldUuid: cloner.userData.archdiscStudioCloner.fieldUuid || null,
  });
  return { ok: true, effectorUuid: uuid, clonerUuid, kind: 'plain', count: N };
}

// ─── Step ───────────────────────────────────────────────────────────────
// Per-step linear ramp. `perStep = { position, rotation, scale }` —
// each XYZ triple multiplied by the instance index (0-based).
export function effectorStep(clonerUuid, perStep) {
  const cloner = findClonerByUuid(clonerUuid);
  if (!cloner) return { ok: false, error: 'no cloner by uuid' };
  const ps = (perStep && typeof perStep === 'object') ? perStep : {};
  const pos = Array.isArray(ps.position) ? ps.position : [0, 0, 0];
  const rot = Array.isArray(ps.rotation) ? ps.rotation : [0, 0, 0];
  const scl = Array.isArray(ps.scale) ? ps.scale : [0, 0, 0];
  const px = +pos[0] || 0, py = +pos[1] || 0, pz = +pos[2] || 0;
  const rx = +rot[0] || 0, ry = +rot[1] || 0, rz = +rot[2] || 0;
  const sx = +scl[0] || 0, sy = +scl[1] || 0, sz = +scl[2] || 0;
  const N = applyToCloner(cloner, (i) => ({
    dPos: new THREE.Vector3(px * i, py * i, pz * i),
    dRot: new THREE.Vector3(rx * i, ry * i, rz * i),
    dScl: new THREE.Vector3(sx * i, sy * i, sz * i),
  }));
  const uuid = makeEffectorUuid('step');
  _effectors.set(uuid, {
    kind: 'step', clonerUuid,
    params: { position: [px, py, pz], rotation: [rx, ry, rz], scale: [sx, sy, sz] },
    fieldUuid: cloner.userData.archdiscStudioCloner.fieldUuid || null,
  });
  return { ok: true, effectorUuid: uuid, clonerUuid, kind: 'step', count: N };
}

// ─── Bind a field to an effector's cloner ───────────────────────────────
// We persist the binding on the cloner so subsequent effector runs
// pick it up automatically. The effector record is also updated.
export function effectorBindField(effectorUuid, fieldUuid) {
  const rec = _effectors.get(effectorUuid);
  if (!rec) return { ok: false, error: 'no effector by uuid' };
  const cloner = findClonerByUuid(rec.clonerUuid);
  if (!cloner) return { ok: false, error: 'no cloner for this effector' };
  // Allow unbinding via null/undefined/empty fieldUuid.
  if (fieldUuid) {
    const f = getField(fieldUuid);
    if (!f) return { ok: false, error: 'no field by uuid' };
  }
  rec.fieldUuid = fieldUuid || null;
  cloner.userData.archdiscStudioCloner.fieldUuid = fieldUuid || null;
  return { ok: true, effectorUuid, fieldUuid: fieldUuid || null };
}

// ─── Inspection (test helper) ───────────────────────────────────────────
export function listEffectors() {
  const out = [];
  _effectors.forEach((rec, uuid) => {
    out.push({
      uuid, kind: rec.kind, clonerUuid: rec.clonerUuid,
      fieldUuid: rec.fieldUuid || null, params: { ...rec.params },
    });
  });
  return { ok: true, count: out.length, effectors: out };
}

export function _resetEffectors() { _effectors.clear(); _seq = 0; }
