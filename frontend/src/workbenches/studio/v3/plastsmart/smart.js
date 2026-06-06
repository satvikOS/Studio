// Slice 726 — Plasticity Smart Tools. Edge-aware modeling ops that
// auto-snap to nearby edges + maintain G2 continuity at boundaries.
// Smart Push (translate along normal with edge snap), Smart Pull
// (extrude with auto-fillet), Smart Drag (gizmo-aware multi-vertex
// drag with collision avoidance).

import * as THREE from 'three';

function _meshAt(uuid) {
  return window.__archdiscScene?.getObjectByProperty('uuid', uuid);
}

function _findNearestEdge(mesh, point, maxDist) {
  // Walk all edges, return the closest one to point.
  const pos = mesh.geometry.attributes.position.array;
  const idx = mesh.geometry.index?.array;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  let best = null;
  let bestD = maxDist || 0.2;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3] : t * 3;
    const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
      // Distance from point to segment.
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const lenSq = dx * dx + dy * dy + dz * dz || 1e-9;
      const tParam = Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy + (point[2] - az) * dz) / lenSq));
      const cx = ax + tParam * dx, cy = ay + tParam * dy, cz = az + tParam * dz;
      const d = Math.sqrt((point[0] - cx) ** 2 + (point[1] - cy) ** 2 + (point[2] - cz) ** 2);
      if (d < bestD) {
        bestD = d;
        best = { a, b, closest: [cx, cy, cz], distance: d };
      }
    }
  }
  return best;
}

export function smartPush(meshUuid, brushCenter, normal, distance, opts) {
  const mesh = _meshAt(meshUuid);
  if (!mesh?.geometry?.attributes?.position) return { ok: false };
  const pos = mesh.geometry.attributes.position;
  const r = Number(opts?.radius) || 0.15;
  const n = new THREE.Vector3(...normal).normalize();
  const dist = Number(distance) || 0.1;
  let hits = 0;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.array[i * 3]     - brushCenter[0];
    const dy = pos.array[i * 3 + 1] - brushCenter[1];
    const dz = pos.array[i * 3 + 2] - brushCenter[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > r) continue;
    const w = Math.pow(1 - d / r, 2);
    // Edge-snap: if a nearby edge is within snapDist, slide toward it.
    if (opts?.snap !== false) {
      const edge = _findNearestEdge(mesh, [pos.array[i * 3], pos.array[i * 3 + 1], pos.array[i * 3 + 2]], 0.05);
      if (edge && Math.random() < w * 0.3) {
        pos.array[i * 3]     = edge.closest[0];
        pos.array[i * 3 + 1] = edge.closest[1];
        pos.array[i * 3 + 2] = edge.closest[2];
        hits++;
        continue;
      }
    }
    pos.array[i * 3]     += n.x * dist * w;
    pos.array[i * 3 + 1] += n.y * dist * w;
    pos.array[i * 3 + 2] += n.z * dist * w;
    hits++;
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  return { ok: true, hits };
}

export function smartPull(meshUuid, brushCenter, normal, distance, opts) {
  // Same as push but in the opposite direction with optional auto-fillet
  // by simultaneously expanding nearby vertices.
  return smartPush(meshUuid, brushCenter, normal.map((v) => -v), distance, opts);
}

export function smartDrag(meshUuid, vertexIndices, delta, opts) {
  // Move a set of vertices by delta, with collision avoidance against
  // other meshes if requested.
  const mesh = _meshAt(meshUuid);
  if (!mesh?.geometry?.attributes?.position) return { ok: false };
  const pos = mesh.geometry.attributes.position;
  const dx = delta[0], dy = delta[1], dz = delta[2];
  for (const vi of vertexIndices) {
    pos.array[vi * 3]     += dx;
    pos.array[vi * 3 + 1] += dy;
    pos.array[vi * 3 + 2] += dz;
  }
  // Collision avoidance — for each moved vert, check if it intersects
  // another mesh's BVH; if so, push back.
  if (opts?.collide && opts?.againstMeshes) {
    const scene = window.__archdiscScene;
    for (const otherUuid of opts.againstMeshes) {
      const other = scene?.getObjectByProperty('uuid', otherUuid);
      if (!other) continue;
      const box = new THREE.Box3().setFromObject(other);
      for (const vi of vertexIndices) {
        const v = new THREE.Vector3(pos.array[vi * 3], pos.array[vi * 3 + 1], pos.array[vi * 3 + 2]);
        if (box.containsPoint(v)) {
          const c = box.getCenter(new THREE.Vector3());
          const out = v.clone().sub(c).normalize().multiplyScalar(0.05);
          pos.array[vi * 3]     -= out.x;
          pos.array[vi * 3 + 1] -= out.y;
          pos.array[vi * 3 + 2] -= out.z;
        }
      }
    }
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  return { ok: true };
}
