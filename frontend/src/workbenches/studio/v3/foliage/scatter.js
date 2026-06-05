// ArchDisc Studio V3 — Unreal-style instanced foliage scatter.
//
// `scatterOnSurface(sourceMeshUuid, targetMeshUuid, count, opts)` reads a
// source mesh (the foliage prop — typically a low-poly tree / rock /
// grass blade) and a target surface mesh (typically slice-678 terrain
// or any other triangle-soup geometry), then emits a single
// `THREE.InstancedMesh` carrying `count` instances. Each instance is:
//
//   • positioned at a random point on the target's surface, weighted by
//     triangle area so dense triangles aren't biased low.
//   • rotated by a deterministic per-instance random Y-rotation (the
//     "wind axis" — wind.js sways the same axis later).
//   • scaled by a uniform random factor in [1-variance, 1+variance].
//
// All per-instance matrices are cached on
// `userData.archdiscStudioFoliage.baseMatrices` so:
//   - wind.js can re-base its sway off the un-perturbed matrices each
//     frame instead of compounding tiny rotations into a runaway spin
//   - lod.js can swap the same matrix slot into its low-poly twin
//   - paint.js can splice individual matrices in/out without trashing
//     the rest of the cache.
//
// Pure native: zero npm dependencies, zero WASM. The triangle-area
// sampler uses a binary search over a cumulative CDF (O(log T) per
// sample) which scales fine to millions of instances on a 64×64
// terrain.
//
// The emitted InstancedMesh is added to the scene at the root (so the
// instance matrices are world-space, matching every other v3
// instancer) and selected via window.__studioSelectMesh — same hand-off
// the cloner module uses so existing outliner / inspector code picks
// it up for free.

import * as THREE from 'three';
import { mulberry32 } from '../common/random.js';
import { scatterOnSurface as _commonScatterOnSurface } from '../common/scatter.js';

const FOLIAGE_TAG = 'archdiscStudioFoliage';

function scene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function viewport() {
  return (typeof window !== 'undefined') ? (window.__archdiscViewport || null) : null;
}

function findMeshByUuid(uuid) {
  const s = scene(); if (!s || !uuid) return null;
  let m = null;
  s.traverse((o) => { if (!m && o.uuid === uuid) m = o; });
  return m;
}

function attachAndSelect(mesh) {
  const s = scene(); if (!s) return;
  s.add(mesh);
  if (typeof window !== 'undefined' && typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(mesh); } catch (_) {}
  }
}

// ─── Triangle-area-weighted surface sampler ─────────────────────────────
// Slice 695 dedup: the area-weighted surface sampler lives in
// common/scatter.js as scatterOnSurface(targetMesh, count, opts). The
// foliage path still owns the InstancedMesh emission + per-instance
// rotation/scale jitter on top, but the position cloud now flows
// through the shared helper. Deterministic PRNG (mulberry32) is also
// imported from common/random.js.

// ─── Public scatter ─────────────────────────────────────────────────────
// opts:
//   seed:       integer (default 1337) — deterministic across runs
//   scaleVariance: 0..1 (default 0.25) — uniform scale jitter ±variance
//   minScale, maxScale: explicit overrides; if both provided they take
//     precedence over scaleVariance
//   randomYRotation: bool, default true — random Y-rotation per instance
//   castShadow / receiveShadow: bool, defaults true / true
export function scatterOnSurface(sourceMeshUuid, targetMeshUuid, count, opts) {
  const src = findMeshByUuid(sourceMeshUuid);
  if (!src || !src.isMesh || !src.geometry || !src.material) {
    return { ok: false, error: 'no source mesh by uuid' };
  }
  const tgt = findMeshByUuid(targetMeshUuid);
  if (!tgt || !tgt.isMesh || !tgt.geometry) {
    return { ok: false, error: 'no target mesh by uuid' };
  }
  const N = Math.max(1, Math.floor(+count || 0));
  const o = opts || {};
  const seed = Number.isFinite(+o.seed) ? (+o.seed | 0) : 1337;
  const variance = Number.isFinite(+o.scaleVariance) ? Math.max(0, +o.scaleVariance) : 0.25;
  const minS = Number.isFinite(+o.minScale) ? +o.minScale : Math.max(0.01, 1 - variance);
  const maxS = Number.isFinite(+o.maxScale) ? +o.maxScale : (1 + variance);
  const randY = (o.randomYRotation === false) ? false : true;

  // Slice 695: area-weighted positions come from common/scatter.js.
  // We pass `worldSpace: true` so the resulting positions live in the
  // same world-frame the InstancedMesh expects, and `includeNormals:
  // false` because foliage rotates about world-Y rather than aligning
  // to face normal (matches the original local behaviour).
  const sampled = _commonScatterOnSurface(tgt, N, {
    seed,
    worldSpace: true,
    includeNormals: false,
  });
  if (!sampled || !sampled.ok) {
    return { ok: false, error: (sampled && sampled.error) || 'scatter failed' };
  }
  const sampledPositions = sampled.positions;

  // Per-instance rotation + scale jitter uses a separate RNG stream
  // seeded off the same seed so reruns reproduce. Position draws are
  // owned by the common helper; this RNG only feeds yRot + scale.
  const rng = mulberry32((seed ^ 0x9E3779B9) >>> 0);
  const dummy = new THREE.Object3D();
  const point = new THREE.Vector3();
  const inst = new THREE.InstancedMesh(src.geometry, src.material, N);
  inst.castShadow = (o.castShadow === false) ? false : true;
  inst.receiveShadow = (o.receiveShadow === false) ? false : true;

  // Cache: world position [x,y,z] + base Y-rotation + uniform scale, per
  // instance. Wind / LOD / paint all consume this snapshot.
  const positions = new Float32Array(N * 3);
  positions.set(sampledPositions);
  const baseRot = new Float32Array(N);
  const baseScale = new Float32Array(N);
  const baseMatrices = new Array(N);

  for (let i = 0; i < N; i++) {
    point.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);

    const yRot = randY ? (rng() * Math.PI * 2) : 0;
    baseRot[i] = yRot;
    const s = minS + (maxS - minS) * rng();
    baseScale[i] = s;

    dummy.position.copy(point);
    dummy.rotation.set(0, yRot, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
    baseMatrices[i] = dummy.matrix.clone();
  }
  inst.instanceMatrix.needsUpdate = true;

  inst.userData.archdiscStudioPrimitive = true;
  inst.userData.archdiscStudioPrimitiveKind = 'foliage';
  inst.userData.pickable = true;
  inst.userData[FOLIAGE_TAG] = {
    sourceUuid: src.uuid,
    targetUuid: tgt.uuid,
    count: N,
    seed,
    variance,
    positions,       // world-space (x,y,z) triplets
    baseRot,         // base Y rotation per instance (radians)
    baseScale,       // uniform scale per instance
    baseMatrices,    // pre-perturbation matrix snapshot
    lod: null,       // populated by lod.js
    wind: null,      // populated by wind.js
  };
  inst.name = `studio-foliage-${N}`;

  attachAndSelect(inst);
  return { ok: true, uuid: inst.uuid, count: N };
}

// ─── Lookup + listing helpers (used by lod / wind / paint / panel) ──────
export function findFoliageByUuid(uuid) {
  const s = scene(); if (!s) return null;
  let m = null;
  s.traverse((o) => {
    if (!m && o.uuid === uuid && o.isInstancedMesh
        && o.userData && o.userData[FOLIAGE_TAG]) m = o;
  });
  return m;
}

export function listFoliage() {
  const s = scene();
  if (!s) return { ok: true, count: 0, foliage: [] };
  const arr = [];
  s.traverse((o) => {
    if (o.isInstancedMesh && o.userData && o.userData[FOLIAGE_TAG]) {
      const f = o.userData[FOLIAGE_TAG];
      arr.push({
        uuid: o.uuid,
        sourceUuid: f.sourceUuid,
        targetUuid: f.targetUuid,
        count: o.count,
        hasLOD: !!f.lod,
        hasWind: !!f.wind,
      });
    }
  });
  return { ok: true, count: arr.length, foliage: arr };
}

export function deleteFoliage(uuid) {
  const inst = findFoliageByUuid(uuid);
  if (!inst) return { ok: false, error: 'no foliage by uuid' };
  // If LOD installed, clean its low-poly partner too.
  if (inst.userData[FOLIAGE_TAG] && inst.userData[FOLIAGE_TAG].lod) {
    const lod = inst.userData[FOLIAGE_TAG].lod;
    if (lod.lowInst && lod.lowInst.parent) {
      lod.lowInst.parent.remove(lod.lowInst);
      try { lod.lowInst.dispose && lod.lowInst.dispose(); } catch (_) {}
    }
  }
  const parent = inst.parent;
  if (parent) parent.remove(inst);
  try { inst.dispose && inst.dispose(); } catch (_) {}
  return { ok: true, uuid };
}

export const __internal = {
  FOLIAGE_TAG,
  mulberry32,
  scene,
  viewport,
  findMeshByUuid,
};
