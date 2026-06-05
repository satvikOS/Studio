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

// ─── Deterministic PRNG (mulberry32) ────────────────────────────────────
// Same hash as MoGraph effectors so a fixed seed reproduces both wind
// and scatter layouts cleanly across tests.
function mulberry32(a) {
  let s = a >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Triangle-area-weighted surface sampler ─────────────────────────────
//
// Walks the target's BufferGeometry once to build:
//   - `triArea[t]`     — area of triangle t (world-space)
//   - `cumArea[t]`     — running sum (== CDF), normalised to 1 at the end
//   - cached world-space vertex positions per triangle (a, b, c)
//
// Then per-sample: u = rand() → binary-search cumArea to land on a
// triangle; pick a uniform point inside that triangle via the classic
// √-warp barycentric trick (so the bias toward the (a) corner is
// removed).
//
// Triangle world positions are computed by transforming the local
// position attribute through `target.matrixWorld` ONCE per triangle and
// stashed as flat Float32Arrays — keeps the per-sample loop pointer-free.
function buildSampler(target) {
  if (!target || !target.geometry) return null;
  const geom = target.geometry;
  const posAttr = geom.getAttribute('position');
  if (!posAttr || posAttr.count === 0) return null;

  // updateMatrixWorld so terrain that hasn't been ticked yet still
  // resolves correctly.
  target.updateMatrixWorld(true);
  const mw = target.matrixWorld;

  // Pre-transform every vertex into world space once.
  const N = posAttr.count;
  const worldPos = new Float32Array(N * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    v.fromBufferAttribute(posAttr, i).applyMatrix4(mw);
    worldPos[i * 3]     = v.x;
    worldPos[i * 3 + 1] = v.y;
    worldPos[i * 3 + 2] = v.z;
  }

  // Index buffer or implicit triplets.
  const idx = geom.getIndex();
  const triCount = idx ? (idx.count / 3) : (N / 3);
  if (triCount < 1) return null;

  const triArea = new Float32Array(triCount);
  const cumArea = new Float32Array(triCount);
  // Flat per-triangle vertex cache: 9 floats per tri (a.xyz, b.xyz, c.xyz).
  const triVerts = new Float32Array(triCount * 9);

  let total = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const cross = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const ia = idx ? idx.getX(t * 3)     : (t * 3);
    const ib = idx ? idx.getX(t * 3 + 1) : (t * 3 + 1);
    const ic = idx ? idx.getX(t * 3 + 2) : (t * 3 + 2);
    a.set(worldPos[ia * 3], worldPos[ia * 3 + 1], worldPos[ia * 3 + 2]);
    b.set(worldPos[ib * 3], worldPos[ib * 3 + 1], worldPos[ib * 3 + 2]);
    c.set(worldPos[ic * 3], worldPos[ic * 3 + 1], worldPos[ic * 3 + 2]);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    const area = cross.crossVectors(ab, ac).length() * 0.5;
    triArea[t] = area;
    total += area;
    cumArea[t] = total;
    const o = t * 9;
    triVerts[o]     = a.x; triVerts[o + 1] = a.y; triVerts[o + 2] = a.z;
    triVerts[o + 3] = b.x; triVerts[o + 4] = b.y; triVerts[o + 5] = b.z;
    triVerts[o + 6] = c.x; triVerts[o + 7] = c.y; triVerts[o + 8] = c.z;
  }
  if (total <= 0) return null;
  // Normalise CDF to [0,1] so a uniform rand maps directly.
  for (let t = 0; t < triCount; t++) cumArea[t] = cumArea[t] / total;

  return { triCount, triArea, cumArea, triVerts, totalArea: total };
}

// Binary-search the cumulative-area CDF; returns the triangle index
// whose bucket contains u.
function pickTri(sampler, u) {
  const arr = sampler.cumArea;
  let lo = 0, hi = sampler.triCount - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < u) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Uniform point inside triangle (a, b, c) — √r1 trick gets uniform
// barycentric coordinates instead of biased ones.
function samplePointInTri(sampler, ti, r1, r2, out) {
  const sr1 = Math.sqrt(r1);
  const u = 1 - sr1;
  const w = r2 * sr1;
  const v = 1 - u - w;
  const o = ti * 9;
  const ax = sampler.triVerts[o],     ay = sampler.triVerts[o + 1], az = sampler.triVerts[o + 2];
  const bx = sampler.triVerts[o + 3], by = sampler.triVerts[o + 4], bz = sampler.triVerts[o + 5];
  const cx = sampler.triVerts[o + 6], cy = sampler.triVerts[o + 7], cz = sampler.triVerts[o + 8];
  out.x = ax * u + bx * v + cx * w;
  out.y = ay * u + by * v + cy * w;
  out.z = az * u + bz * v + cz * w;
}

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

  const sampler = buildSampler(tgt);
  if (!sampler) return { ok: false, error: 'target has no valid triangles' };

  const rng = mulberry32(seed);
  const dummy = new THREE.Object3D();
  const point = new THREE.Vector3();
  const inst = new THREE.InstancedMesh(src.geometry, src.material, N);
  inst.castShadow = (o.castShadow === false) ? false : true;
  inst.receiveShadow = (o.receiveShadow === false) ? false : true;

  // Cache: world position [x,y,z] + base Y-rotation + uniform scale, per
  // instance. Wind / LOD / paint all consume this snapshot.
  const positions = new Float32Array(N * 3);
  const baseRot = new Float32Array(N);
  const baseScale = new Float32Array(N);
  const baseMatrices = new Array(N);

  for (let i = 0; i < N; i++) {
    const u = rng();
    const ti = pickTri(sampler, u);
    const r1 = rng(), r2 = rng();
    samplePointInTri(sampler, ti, r1, r2, point);
    positions[i * 3]     = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;

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
  buildSampler,
  pickTri,
  samplePointInTri,
  mulberry32,
  scene,
  viewport,
  findMeshByUuid,
};
