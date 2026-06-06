// Slice 725 — 3ds Max Forest Pack-style procedural scatter. Distinct
// from slice-686 foliage (Unreal instanced placement w/ LOD): adds
// per-instance size + rotation jitter, distribution maps (greyscale
// canvas mask), collision avoidance, slope cutoff (no spawning on
// surfaces steeper than X), and altitude cutoff.

import * as THREE from 'three';

const _scatters = new Map();
let _seq = 1;
function _uid() { return `fp-${_seq++}-${Date.now().toString(36)}`; }

function _sampleDistributionMap(mask, u, v) {
  if (!mask) return 1;
  const w = mask.width, h = mask.height;
  const x = Math.max(0, Math.min(w - 1, Math.floor(u * w)));
  const y = Math.max(0, Math.floor(v * h));
  const yy = Math.max(0, Math.min(h - 1, y));
  const i = (yy * w + x) * 4;
  return mask.data[i] / 255;
}

export function createScatter(opts) {
  const surfaceUuid = opts?.surfaceUuid;
  const sourceObjectUuid = opts?.sourceObjectUuid;
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const surface = scene.getObjectByProperty('uuid', surfaceUuid);
  const source = scene.getObjectByProperty('uuid', sourceObjectUuid);
  if (!surface || !source) return { ok: false };
  const count = Math.max(10, Math.min(20000, Number(opts?.count) || 500));
  const sizeMin = Number(opts?.sizeMin) || 0.6;
  const sizeMax = Number(opts?.sizeMax) || 1.4;
  const rotJitter = Number(opts?.rotJitter) || Math.PI;
  const slopeCutoff = Number(opts?.slopeCutoff ?? 0.5);   // dot(normal, up) ≥ this
  const altitudeMin = Number(opts?.altitudeMin ?? -Infinity);
  const altitudeMax = Number(opts?.altitudeMax ?? Infinity);
  const collisionRadius = Number(opts?.collisionRadius) || 0;
  const distributionMap = opts?.distributionMap || null;   // ImageData
  const id = _uid();

  // Sample surface triangles area-weighted; place instances.
  const pos = surface.geometry.attributes.position.array;
  const idx = surface.geometry.index?.array;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  surface.updateMatrixWorld(true);
  const placements = [];
  const accepted = [];
  let attempts = 0;
  const maxAttempts = count * 5;
  while (placements.length < count && attempts++ < maxAttempts) {
    const t = Math.floor(Math.random() * triCount);
    const i0 = idx ? idx[t * 3] : t * 3;
    const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    let u = Math.random(), v = Math.random();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    const px = pos[i0 * 3] * w + pos[i1 * 3] * u + pos[i2 * 3] * v;
    const py = pos[i0 * 3 + 1] * w + pos[i1 * 3 + 1] * u + pos[i2 * 3 + 1] * v;
    const pz = pos[i0 * 3 + 2] * w + pos[i1 * 3 + 2] * u + pos[i2 * 3 + 2] * v;
    const local = new THREE.Vector3(px, py, pz).applyMatrix4(surface.matrixWorld);
    // Slope cutoff: compute triangle normal.
    const ax = pos[i1 * 3] - pos[i0 * 3], ay = pos[i1 * 3 + 1] - pos[i0 * 3 + 1], az = pos[i1 * 3 + 2] - pos[i0 * 3 + 2];
    const bx = pos[i2 * 3] - pos[i0 * 3], by = pos[i2 * 3 + 1] - pos[i0 * 3 + 1], bz = pos[i2 * 3 + 2] - pos[i0 * 3 + 2];
    const cnx = ay * bz - az * by, cny = az * bx - ax * bz, cnz = ax * by - ay * bx;
    const cnl = Math.hypot(cnx, cny, cnz) || 1;
    const dotUp = cny / cnl;
    if (dotUp < slopeCutoff) continue;
    if (local.y < altitudeMin || local.y > altitudeMax) continue;
    // Distribution map sample (just use surface bbox UV).
    if (distributionMap) {
      // Quick UV: project to surface bbox.
      const box = new THREE.Box3().setFromObject(surface);
      const sz = box.getSize(new THREE.Vector3());
      const uu = sz.x === 0 ? 0 : (local.x - box.min.x) / sz.x;
      const vv = sz.z === 0 ? 0 : (local.z - box.min.z) / sz.z;
      const m = _sampleDistributionMap(distributionMap, uu, vv);
      if (Math.random() > m) continue;
    }
    // Collision avoidance.
    if (collisionRadius > 0) {
      let collide = false;
      for (const p of accepted) {
        const dx = local.x - p.x, dy = local.y - p.y, dz = local.z - p.z;
        if (dx * dx + dy * dy + dz * dz < collisionRadius * collisionRadius) { collide = true; break; }
      }
      if (collide) continue;
    }
    accepted.push(local.clone());
    placements.push({
      position: [local.x, local.y, local.z],
      rotationY: (Math.random() - 0.5) * 2 * rotJitter,
      scale: sizeMin + Math.random() * (sizeMax - sizeMin),
    });
  }
  // Build an InstancedMesh.
  const sourceMesh = source;
  const instanced = new THREE.InstancedMesh(sourceMesh.geometry, sourceMesh.material, placements.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < placements.length; i++) {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), placements[i].rotationY);
    m.compose(
      new THREE.Vector3(...placements[i].position),
      q,
      new THREE.Vector3(placements[i].scale, placements[i].scale, placements[i].scale));
    instanced.setMatrixAt(i, m);
  }
  instanced.instanceMatrix.needsUpdate = true;
  instanced.name = `forest-pack-${id}`;
  instanced.userData.archdiscStudioPrimitive = true;
  instanced.userData.archdiscStudioPrimitiveKind = 'forest-pack';
  scene.add(instanced);
  const sc = { id, instanced, placements, count: placements.length };
  _scatters.set(id, sc);
  return { ok: true, id, uuid: instanced.uuid, instances: placements.length };
}

export function deleteScatter(id) {
  const s = _scatters.get(id);
  if (!s) return { ok: false };
  if (s.instanced.parent) s.instanced.parent.remove(s.instanced);
  s.instanced.dispose?.();
  _scatters.delete(id);
  return { ok: true };
}

export function listScatters() {
  return {
    ok: true,
    scatters: Array.from(_scatters.values()).map((s) => ({
      id: s.id, uuid: s.instanced.uuid, count: s.count,
    })),
  };
}
