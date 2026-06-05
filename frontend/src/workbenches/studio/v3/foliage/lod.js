// ArchDisc Studio V3 — foliage LOD swap.
//
// `setupLOD(scatterUuid, lowMeshUuid, distanceThreshold)` installs a
// two-bucket LOD scheme on an existing foliage InstancedMesh:
//
//   • the existing InstancedMesh (high-poly) keeps the full source
//     mesh's geometry + material;
//   • a sibling InstancedMesh sharing the SAME slot count is created
//     from `lowMeshUuid` (a reduced-poly variant, typically a
//     decimated copy or a flat billboard);
//   • every frame, an `__foliageLOD` tick walks every instance's cached
//     world position, computes the distance to the active camera, and
//     hides the per-slot matrix on whichever bucket shouldn't render it.
//
// Hiding strategy:
//   We don't toggle `inst.count` (that would re-order indices and lose
//   per-instance correspondence with wind / paint). Instead, the
//   matrix on the dormant side is collapsed to a degenerate zero-scale
//   matrix at the same world position — three's instance shader skips
//   the draw because the post-projection bounds shrink to a point.
//   `instanceMatrix.needsUpdate = true` is only set on a swap-frame.
//
// Tick chain:
//   The tick is tagged `__foliageLOD = true` + `__prev = prevTick` and
//   walks the existing chain so anim / sim / fx ticks still run. We
//   bail cheap when no camera or no scatter exists.
//
// `removeLOD(scatterUuid)` splices the tick out, disposes the low
// InstancedMesh, and restores every high matrix from its base snapshot.

import * as THREE from 'three';
import { findFoliageByUuid, __internal as scatterInt } from './scatter.js';
import { __internal as windInt } from './wind.js';

const TAG = scatterInt.FOLIAGE_TAG;

// ─── Module-state: registry of every LOD pair currently active ─────────
const _lods = new Map(); // scatterUuid → { highInst, lowInst, distance, threshSq }

function viewport() {
  return (typeof window !== 'undefined') ? (window.__archdiscViewport || null) : null;
}

function camera() {
  const vp = viewport();
  return (vp && vp.camera) || null;
}

function scene() {
  return scatterInt.scene();
}

// ─── Build the low-poly twin InstancedMesh ─────────────────────────────
function createLowInstancedMesh(highInst, lowSourceMesh) {
  const N = highInst.count;
  const lowInst = new THREE.InstancedMesh(lowSourceMesh.geometry, lowSourceMesh.material, N);
  lowInst.castShadow = !!highInst.castShadow;
  lowInst.receiveShadow = !!highInst.receiveShadow;
  // Mirror tag so listFoliage doesn't see it as a separate foliage,
  // but mark explicitly as the low partner.
  lowInst.userData.archdiscStudioPrimitive = true;
  lowInst.userData.archdiscStudioPrimitiveKind = 'foliage-lod-low';
  lowInst.userData.archdiscStudioFoliageLOD = {
    highUuid: highInst.uuid,
    sourceUuid: lowSourceMesh.uuid,
  };
  lowInst.name = `studio-foliage-low-${N}`;
  // Seed every slot to the same baseline matrix as the high inst, so
  // before the first tick runs it doesn't pop visibly at the origin.
  const m = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    highInst.getMatrixAt(i, m);
    lowInst.setMatrixAt(i, m);
  }
  lowInst.instanceMatrix.needsUpdate = true;
  return lowInst;
}

// Collapse a matrix slot to a zero-scale degenerate at the same
// translation. Three.js skips the draw because the projected
// bounding-sphere radius is 0 (and the geometry itself is a single
// degenerate point in post-transform space).
const _zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);

function setSlotHidden(inst, idx, baseMatrix, tmpMat) {
  // tmpMat = baseMatrix · zero-scale. Multiplication order doesn't
  // matter for a uniform-zero scale; copy then zero the 3×3.
  tmpMat.copy(baseMatrix);
  // Wipe rotation/scale columns to 0; keep translation column intact.
  const e = tmpMat.elements;
  e[0] = 0; e[1] = 0; e[2] = 0;
  e[4] = 0; e[5] = 0; e[6] = 0;
  e[8] = 0; e[9] = 0; e[10] = 0;
  inst.setMatrixAt(idx, tmpMat);
}

// ─── Per-frame LOD tick (chained into __studioAnimTick) ────────────────
//
// LOD is the SINGLE writer of instance matrices on both high + low
// when active. If a wind record exists for this scatter, LOD computes
// the swayed matrix inline (cheap sin per instance) and uses that as
// the "live" matrix; otherwise it falls back to the un-perturbed
// baseMatrices snapshot. This avoids any tick-chain order dependency
// between wind.js and lod.js — they can install in either order.
function lodFrame() {
  const cam = camera();
  if (!cam) return;
  cam.updateMatrixWorld(true);
  const cx = cam.matrixWorld.elements[12];
  const cy = cam.matrixWorld.elements[13];
  const cz = cam.matrixWorld.elements[14];

  const tmpHigh = new THREE.Matrix4();
  const tmpLow = new THREE.Matrix4();
  const liveM = new THREE.Matrix4();
  const dummy = new THREE.Object3D();

  // Resolve wind time once per frame (matches wind.js's anchor).
  const nowMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const tNow = (nowMs - windInt.startMs()) / 1000;

  _lods.forEach((rec) => {
    const high = rec.highInst;
    const low = rec.lowInst;
    if (!high || !low) return;
    const meta = high.userData && high.userData[TAG];
    if (!meta) return;
    const positions = meta.positions;
    const baseMatrices = meta.baseMatrices;
    const baseRot = meta.baseRot;
    const baseScale = meta.baseScale;
    const N = high.count;
    const tSq = rec.threshSq;
    const windRec = windInt.getWindRec(high.uuid); // null if no wind
    for (let i = 0; i < N; i++) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      const dx = px - cx, dy = py - cy, dz = pz - cz;
      const distSq = dx * dx + dy * dy + dz * dz;
      const isFar = distSq > tSq;
      if (windRec) {
        // Inline-rebuild the swayed matrix so we don't depend on tick order.
        const phase = (windRec.phases.length > i)
          ? windRec.phases[i]
          : windInt.phaseFor(meta.seed | 0, i);
        const offset = Math.sin(tNow * windRec.freq + phase) * windRec.strength;
        dummy.position.set(px, py, pz);
        dummy.rotation.set(0, baseRot[i] + offset, 0);
        const s = baseScale[i];
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        liveM.copy(dummy.matrix);
      } else {
        liveM.fromArray(baseMatrices[i].elements);
      }
      if (isFar) {
        setSlotHidden(high, i, liveM, tmpHigh);
        low.setMatrixAt(i, liveM);
      } else {
        high.setMatrixAt(i, liveM);
        setSlotHidden(low, i, liveM, tmpLow);
      }
    }
    high.instanceMatrix.needsUpdate = true;
    low.instanceMatrix.needsUpdate = true;
  });
}

// ─── Chain helpers ──────────────────────────────────────────────────────
function _hasLODTickIn(v) {
  let cur = v.__studioAnimTick;
  while (cur) {
    if (cur.__foliageLOD) return true;
    cur = cur.__prev;
  }
  return false;
}

function _ensureLODTick() {
  const v = viewport();
  if (!v) return false;
  if (_hasLODTickIn(v)) return true;
  const prev = v.__studioAnimTick;
  const chained = (now) => {
    try { lodFrame(); } catch (_) {}
    if (prev) { try { prev(now); } catch (_) {} }
  };
  chained.__foliageLOD = true;
  chained.__prev = prev;
  v.__studioAnimTick = chained;
  return true;
}

function _removeLODTickIfEmpty() {
  if (_lods.size > 0) return;
  const v = viewport();
  if (!v) return;
  // Walk + splice exactly our link.
  const links = [];
  let cur = v.__studioAnimTick;
  while (cur) { links.push(cur); cur = cur.__prev; }
  const kept = links.filter((l) => !l.__foliageLOD);
  for (let i = 0; i < kept.length - 1; i++) kept[i].__prev = kept[i + 1];
  if (kept.length) kept[kept.length - 1].__prev = null;
  v.__studioAnimTick = kept[0] || null;
}

// ─── Public ─────────────────────────────────────────────────────────────
export function setupLOD(scatterUuid, lowMeshUuid, distanceThreshold) {
  const high = findFoliageByUuid(scatterUuid);
  if (!high) return { ok: false, error: 'no foliage scatter by uuid' };
  const low = scatterInt.findMeshByUuid(lowMeshUuid);
  if (!low || !low.isMesh || !low.geometry || !low.material) {
    return { ok: false, error: 'no low mesh by uuid' };
  }
  const D = Math.max(0.01, +distanceThreshold || 10);
  // If a LOD record already exists for this scatter, replace it.
  const prev = _lods.get(scatterUuid);
  if (prev && prev.lowInst && prev.lowInst.parent) {
    prev.lowInst.parent.remove(prev.lowInst);
    try { prev.lowInst.dispose && prev.lowInst.dispose(); } catch (_) {}
  }
  const lowInst = createLowInstancedMesh(high, low);
  const s = scene(); if (s) s.add(lowInst);
  const rec = {
    highInst: high,
    lowInst,
    lowSourceUuid: low.uuid,
    distance: D,
    threshSq: D * D,
  };
  _lods.set(scatterUuid, rec);
  // Stash on userData so listFoliage can report hasLOD: true.
  if (high.userData && high.userData[TAG]) {
    high.userData[TAG].lod = {
      lowInst,
      lowSourceUuid: low.uuid,
      distance: D,
    };
  }
  _ensureLODTick();
  // Run one frame immediately so the LOD state is correct before next paint.
  try { lodFrame(); } catch (_) {}
  return { ok: true, scatterUuid, lowUuid: lowInst.uuid, distance: D };
}

export function setLODDistance(scatterUuid, distance) {
  const rec = _lods.get(scatterUuid);
  if (!rec) return { ok: false, error: 'no lod for that scatter' };
  const D = Math.max(0.01, +distance || 0.01);
  rec.distance = D;
  rec.threshSq = D * D;
  const high = rec.highInst;
  if (high && high.userData && high.userData[TAG] && high.userData[TAG].lod) {
    high.userData[TAG].lod.distance = D;
  }
  try { lodFrame(); } catch (_) {}
  return { ok: true, scatterUuid, distance: D };
}

export function removeLOD(scatterUuid) {
  const rec = _lods.get(scatterUuid);
  if (!rec) return { ok: false, error: 'no lod for that scatter' };
  _lods.delete(scatterUuid);
  if (rec.lowInst && rec.lowInst.parent) rec.lowInst.parent.remove(rec.lowInst);
  try { rec.lowInst.dispose && rec.lowInst.dispose(); } catch (_) {}
  // Restore every high matrix from its base snapshot so a hidden slot
  // (post-far) pops back to visible.
  const high = rec.highInst;
  if (high && high.userData && high.userData[TAG]) {
    const meta = high.userData[TAG];
    const N = high.count;
    for (let i = 0; i < N; i++) {
      high.setMatrixAt(i, meta.baseMatrices[i]);
    }
    high.instanceMatrix.needsUpdate = true;
    meta.lod = null;
  }
  _removeLODTickIfEmpty();
  return { ok: true, scatterUuid };
}

export function listLOD() {
  const arr = [];
  _lods.forEach((rec, scatterUuid) => {
    arr.push({
      scatterUuid,
      lowUuid: rec.lowInst && rec.lowInst.uuid,
      lowSourceUuid: rec.lowSourceUuid,
      distance: rec.distance,
    });
  });
  return { ok: true, count: arr.length, lods: arr };
}

// Used by paint.js after it grows the InstancedMesh's backing buffer:
// the LOD registry holds its own ref to the low InstancedMesh, so when
// paint.js swaps the high inst for a larger one (and recreates the low
// inst alongside it), we need to update the registry too. Returns true
// if the rebind landed.
export function rebindLowInst(scatterUuid, newLowInst) {
  const rec = _lods.get(scatterUuid);
  if (!rec) return false;
  rec.lowInst = newLowInst;
  return true;
}
export function rebindHighInst(scatterUuid, newHighInst) {
  const rec = _lods.get(scatterUuid);
  if (!rec) return false;
  rec.highInst = newHighInst;
  return true;
}

export const __internal = { _lods, lodFrame, setSlotHidden };
