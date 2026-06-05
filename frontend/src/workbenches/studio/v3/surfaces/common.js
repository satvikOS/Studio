// ArchDisc Studio V3 — surface op shared helpers.
//
// Tiny set of utilities the six surface ops (fillet / chamfer / offset /
// shell / unfold / stitch) all need:
//
//   - findMeshByUuid       scene-traverse lookup
//   - pushUndo             defer to studio's undo stack
//   - ensureIndexed        if geom lacks .index, give it one
//   - copyVerts / copyIdx  pull buffer attrs into JS arrays
//   - rebuildGeometry      swap the mesh's BufferGeometry for new data
//   - parseEdgeKey         "a_b" → [a,b] (rejects malformed strings)
//   - makeEdgeKey          [a,b] → "min_max"
//   - triNormalIdx         compute a face normal into a Vector3
//   - vertexAdjacency      per-vertex neighbour list (via the index)
//
// Keeping these here (instead of importing editmore's privates) leaves
// the editmore/ directory untouched per slice contract.

import * as THREE from 'three';

export function findMeshByUuid(uuid) {
  if (typeof window === 'undefined') return null;
  const scene = window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene);
  if (!scene || !uuid) return null;
  let hit = null;
  scene.traverse((o) => { if (!hit && o.uuid === uuid && o.isMesh) hit = o; });
  return hit;
}

export function activeMesh() {
  if (typeof window === 'undefined') return null;
  if (typeof window.__studioSelectedMesh === 'function') {
    try { const m = window.__studioSelectedMesh(); if (m && m.geometry) return m; } catch (_) {}
  }
  const vp = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}

export function pushUndo() {
  if (typeof window !== 'undefined' && typeof window.__studioPushUndo === 'function') {
    try { window.__studioPushUndo('surface-op'); } catch (_) {}
  }
}

export function ensureIndexed(geo) {
  if (geo.index) return geo;
  const pos = geo.attributes.position;
  if (!pos) return geo;
  const idx = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) idx[i] = i;
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

export function copyVerts(posAttr) {
  const out = new Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    out[i * 3]     = posAttr.getX(i);
    out[i * 3 + 1] = posAttr.getY(i);
    out[i * 3 + 2] = posAttr.getZ(i);
  }
  return out;
}

export function copyIdx(idxAttr) {
  const out = new Array(idxAttr.count);
  for (let i = 0; i < idxAttr.count; i++) out[i] = idxAttr.getX(i);
  return out;
}

export function rebuildGeometry(mesh, outVerts, outIdx) {
  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(outVerts, 3));
  newGeo.setIndex(
    outIdx.length > 65535
      ? new THREE.Uint32BufferAttribute(outIdx, 1)
      : new THREE.Uint16BufferAttribute(outIdx, 1),
  );
  newGeo.computeVertexNormals();
  newGeo.computeBoundingBox();
  newGeo.computeBoundingSphere();
  if (mesh.geometry) {
    if (mesh.geometry.boundsTree && mesh.geometry.disposeBoundsTree) {
      try { mesh.geometry.disposeBoundsTree(); } catch (_) {}
    }
    mesh.geometry.dispose();
  }
  mesh.geometry = newGeo;
  return newGeo;
}

export function makeEdgeKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export function parseEdgeKey(k) {
  if (typeof k !== 'string' || k.indexOf('_') < 0) return null;
  const [a, b] = k.split('_').map((s) => parseInt(s, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return [a, b];
}

export function triNormalIdx(verts, ia, ib, ic, out) {
  const ax = verts[ia * 3], ay = verts[ia * 3 + 1], az = verts[ia * 3 + 2];
  const bx = verts[ib * 3], by = verts[ib * 3 + 1], bz = verts[ib * 3 + 2];
  const cx = verts[ic * 3], cy = verts[ic * 3 + 1], cz = verts[ic * 3 + 2];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  out.set(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx);
  const len = out.length();
  if (len > 1e-12) out.divideScalar(len);
  return out;
}

// Per-vertex neighbour list (undirected). Returns Array<Set<number>>.
export function vertexAdjacency(idx, vertCount) {
  const adj = new Array(vertCount);
  for (let i = 0; i < vertCount; i++) adj[i] = new Set();
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f], b = idx[f + 1], c = idx[f + 2];
    adj[a].add(b); adj[a].add(c);
    adj[b].add(a); adj[b].add(c);
    adj[c].add(a); adj[c].add(b);
  }
  return adj;
}

// Per-vertex outward normal in mesh-local space. Returns Float32Array of
// length verts.length (same layout as positions).
export function perVertexNormals(verts, idx) {
  const out = new Float32Array(verts.length);
  const n = new THREE.Vector3();
  for (let f = 0; f < idx.length; f += 3) {
    const ia = idx[f], ib = idx[f + 1], ic = idx[f + 2];
    triNormalIdx(verts, ia, ib, ic, n);
    for (const v of [ia, ib, ic]) {
      out[v * 3]     += n.x;
      out[v * 3 + 1] += n.y;
      out[v * 3 + 2] += n.z;
    }
  }
  for (let v = 0; v < verts.length / 3; v++) {
    const x = out[v * 3], y = out[v * 3 + 1], z = out[v * 3 + 2];
    const L = Math.sqrt(x * x + y * y + z * z);
    if (L > 1e-12) {
      out[v * 3]     = x / L;
      out[v * 3 + 1] = y / L;
      out[v * 3 + 2] = z / L;
    }
  }
  return out;
}

// Build directed boundary edges (a→b) appearing in only one face.
// Returns Array<{a,b,face}>.
export function boundaryEdges(idx) {
  const counts = new Map();
  const triCount = idx.length / 3;
  for (let f = 0; f < triCount; f++) {
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = makeEdgeKey(u, v);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  const out = [];
  for (let f = 0; f < triCount; f++) {
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = makeEdgeKey(u, v);
      if (counts.get(k) === 1) out.push({ a: u, b: v, face: f });
    }
  }
  return out;
}
