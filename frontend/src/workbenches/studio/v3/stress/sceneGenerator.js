// ArchDisc Studio V3 — stress test scene generators (slice 788).
//
// Spawns the heavy-duty scenes the stress harness uses to measure
// renderer throughput / FPS / memory under load. The honest goal here
// is to land enough TRIANGLES in the viewport to push the
// render-on-demand (slice 752) gate, the adaptive frustum, and the
// raycaster all at once — the same workload a 1M-poly imported CAD
// assembly or a stress-tested fluid sim would produce.
//
//   generateBigScene({targetTris, instanceCount})
//     Spawns a single THREE.InstancedMesh of a high-poly icosahedron
//     sphere (geometry tris × instance count ≈ targetTris). A sphere
//     instance is the most pixel-dense per-tri primitive THREE exposes
//     out of the box — much heavier than cubes/quads for the same
//     triangle budget, so the GPU actually has to do work per draw.
//     Returns { mesh, actualTris, instanceCount, perInstanceTris }.
//
//   generateBigParticleScene({count})
//     Spawns a slice-764 Niagara emitter + the slice-764 buildParticleMesh
//     InstancedMesh sized to `count` particles. Reuses the existing
//     particle pipeline so the harness exercises the same code paths
//     the slice-764 / slice-777 modules run under live FX. Returns
//     { mesh, emitter, count }.
//
// Determinism: instance transforms use mulberry32 from common/random.js
// — NEVER Math.random.

import * as THREE from 'three';
import { mulberry32 } from '../common/random.js';
import { Emitter } from '../nia2/emitter.js';
import { buildParticleMesh, updateParticleMesh } from '../nia2/render.js';

// Pick a sphere subdivision count whose triangle output is closest to
// `perInstance` from the standard IcosahedronGeometry detail levels.
// IcosahedronGeometry(radius, detail) emits 20 * 4^detail triangles.
//
// Triangle counts by detail:
//   detail=0  →  20      tris
//   detail=1  →  80      tris
//   detail=2  →  320     tris
//   detail=3  →  1280    tris
//   detail=4  →  5120    tris
//   detail=5  →  20480   tris
//   detail=6  →  81920   tris
//
// We need to balance: at low instance counts we want high-detail spheres
// (lots of vertices per draw); at high instance counts we want low-detail
// spheres (lots of draws of cheap geometry). A 1M-tri budget split across
// 100 instances → 10k tris each → detail 4 (5120 tris) bumps to detail 5
// (20480 tris) at the next step.
function _pickIcoDetail(perInstanceTris) {
  let best = 0;
  let bestErr = Infinity;
  for (let d = 0; d <= 6; d++) {
    const tris = 20 * Math.pow(4, d);
    const err = Math.abs(Math.log(tris) - Math.log(Math.max(1, perInstanceTris)));
    if (err < bestErr) { bestErr = err; best = d; }
  }
  return best;
}

// Build a deterministic transform matrix for instance i.
// Sites are scattered inside a cube of side `extent` using mulberry32
// indexed off the instance index so two runs with the same seed produce
// the same scene.
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
function _instanceMatrix(i, rng, extent, baseScale) {
  const px = (rng() - 0.5) * extent;
  const py = (rng() - 0.5) * extent;
  const pz = (rng() - 0.5) * extent;
  const ax = rng() * Math.PI * 2;
  const ay = rng() * Math.PI * 2;
  const az = rng() * Math.PI * 2;
  _q.setFromEuler(new THREE.Euler(ax, ay, az));
  // Per-instance scale jitter ±25% around baseScale so the AABB grows
  // smoothly and frustum culling has something to do.
  const s = baseScale * (0.75 + rng() * 0.5);
  _v.set(s, s, s);
  _m.compose(new THREE.Vector3(px, py, pz), _q, _v);
  return _m;
}

// ── generateBigScene ─────────────────────────────────────────────────
//
// Build one InstancedMesh of a high-poly icosphere whose total
// triangle count approximates `targetTris`. The mesh is tagged with
// `userData.archdiscStudioStress = true` so the harness can prune it
// across runs without touching user content.
//
// Args:
//   targetTris:    number — total triangles (default 1_000_000).
//   instanceCount: number — instance count (default 100). Caller can
//                  also drop this lower to drive a fewer-but-heavier
//                  geometry stress profile.
//   extent:        number — half-side of the cube the instances scatter
//                  through (default 50). Bigger = more frustum culling.
//   seed:          number — mulberry32 seed (default 7880).
//
// Returns:
//   { mesh, actualTris, instanceCount, perInstanceTris, detail }
//
export function generateBigScene(opts) {
  const o = opts || {};
  const targetTris = Number.isFinite(+o.targetTris) ? Math.max(20, +o.targetTris) : 1_000_000;
  const instanceCount = Number.isFinite(+o.instanceCount)
    ? Math.max(1, Math.floor(+o.instanceCount))
    : 100;
  const extent = Number.isFinite(+o.extent) ? Math.max(1, +o.extent) : 50;
  const seed = Number.isFinite(+o.seed) ? +o.seed : 7880;
  const baseScale = Number.isFinite(+o.baseScale) ? +o.baseScale : 1.0;

  // Solve detail level so geo-tris × instance-count ≈ targetTris.
  const perInstanceTris = targetTris / instanceCount;
  const detail = _pickIcoDetail(perInstanceTris);
  const geo = new THREE.IcosahedronGeometry(1.0, detail);
  // IcosahedronGeometry is non-indexed by default in THREE r0.181 —
  // `position` length / 3 / 3 = triangle count. We respect whichever
  // path the geometry was built with.
  const geoTris = geo.index
    ? geo.index.count / 3
    : geo.attributes.position.count / 3;

  const mat = new THREE.MeshStandardMaterial({
    color: 0x88aaee,
    metalness: 0.2,
    roughness: 0.6,
    flatShading: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, instanceCount);
  mesh.name = 'studio-stress-bigscene';
  mesh.userData.archdiscStudioStress = true;
  mesh.userData.archdiscStudioStressKind = 'bigscene';
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'stress-bigscene';

  const rng = mulberry32(seed);
  for (let i = 0; i < instanceCount; i++) {
    mesh.setMatrixAt(i, _instanceMatrix(i, rng, extent, baseScale));
  }
  mesh.instanceMatrix.needsUpdate = true;
  // Big scenes routinely sit partly outside any camera frustum — skip
  // the per-frame InstancedMesh.boundingSphere intersection check so
  // we measure pure draw throughput, not culling overhead.
  mesh.frustumCulled = false;

  const actualTris = geoTris * instanceCount;
  return { mesh, actualTris, instanceCount, perInstanceTris: geoTris, detail };
}

// ── generateBigParticleScene ─────────────────────────────────────────
//
// Spawn a slice-764 Niagara `Emitter` + matching InstancedMesh sized to
// `count` particles, then prefill the pool so the very first frame is
// fully populated (otherwise the harness measures spawn-fill, not
// throughput).
//
// Reuses the slice-764 emitter rather than rolling a parallel one so
// the harness exercises the SAME pipeline live FX shipping in slices
// 764 (nia2) and 777 (popfx) use under user-visible workflows.
//
// Args:
//   count:    number — particle pool size (default 200_000).
//   life:     number — particle lifetime in seconds (default 60).
//   spawnRate:number — particles/sec (default = count, fills in ≤1s).
//   seed:     number — mulberry32 seed (default 7880).
//   gravity:  [x,y,z] — accel applied per step.
//
// Returns:
//   { mesh, emitter, count }
//
export function generateBigParticleScene(opts) {
  const o = opts || {};
  const count = Number.isFinite(+o.count) ? Math.max(1, Math.floor(+o.count)) : 200_000;
  const life = Number.isFinite(+o.life) ? Math.max(0.1, +o.life) : 60;
  const spawnRate = Number.isFinite(+o.spawnRate) ? Math.max(1, +o.spawnRate) : count;
  const seed = Number.isFinite(+o.seed) ? +o.seed : 7880;
  const gravity = Array.isArray(o.gravity) ? o.gravity : [0, -0.5, 0];

  const emitter = new Emitter({
    count,
    spawnRate,
    lifeMin: life,
    lifeMax: life,
    seed,
    gravity,
    velocityMin: [-2, 1, -2],
    velocityMax: [2, 4, 2],
    drag: 0.1,
    initialSize: 0.05,
  });
  // Prefill the pool so the harness sees a fully-populated stream from
  // the first measured frame. We step long enough at `spawnRate` to
  // saturate the pool, with `dt` clipped by the emitter to ≤0.1.
  const fillSteps = Math.ceil((count / spawnRate) * 10) + 2;
  for (let s = 0; s < fillSteps; s++) emitter.update(0.1);

  const mesh = buildParticleMesh(emitter);
  // The buildParticleMesh path tags the mesh as a nia2-emitter
  // primitive; overlay the stress flag so prune-by-stress sees it but
  // also keep the original tag so the outliner still recognises it.
  mesh.name = 'studio-stress-particles';
  mesh.userData.archdiscStudioStress = true;
  mesh.userData.archdiscStudioStressKind = 'particles';
  // Push the current emitter state into the mesh's per-instance buffers
  // before we hand it back so the first viewport frame is meaningful.
  updateParticleMesh(mesh, emitter);
  return { mesh, emitter, count };
}

// Helper used by the index op + tests: walks a scene and yields every
// mesh tagged by either of the two generators above. Used by `clear`
// + memoryProfile to avoid scanning the whole scene each call.
export function findStressMeshes(scene) {
  const found = [];
  if (!scene || typeof scene.traverse !== 'function') return found;
  scene.traverse((o) => {
    if (o && o.userData && o.userData.archdiscStudioStress) found.push(o);
  });
  return found;
}
