// Slice 705 — Marvelous Designer-style 2D garment pattern builder.
// A garment is a set of 2D polygonal patterns + seams that join
// pattern edges. patternToMesh tessellates each polygon, sews seams
// by averaging edge vertices, and drapes the result via a quick
// mass-spring relax against the slice-686 cloth solver (or in-house
// Verlet if absent).

import * as THREE from 'three';

const _garments = new Map();
let _seq = 1;
function _uid() { return `gm-${_seq++}-${Date.now().toString(36)}`; }

function _ear2D(verts2D) {
  // Polygon triangulation via ear clipping. Returns array of triangle index triples.
  const tris = [];
  const idx = verts2D.map((_, i) => i);
  function _area(ia, ib, ic) {
    const a = verts2D[ia], b = verts2D[ib], c = verts2D[ic];
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }
  function _inTri(p, ia, ib, ic) {
    const a = verts2D[ia], b = verts2D[ib], c = verts2D[ic];
    const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
    const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
    const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(hasNeg && hasPos);
  }
  let guard = 0;
  while (idx.length > 3 && guard++ < 1000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i - 1 + idx.length) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      if (_area(ia, ib, ic) <= 0) continue;
      let isEar = true;
      for (let j = 0; j < idx.length; j++) {
        if (j === i || idx[j] === ia || idx[j] === ic) continue;
        if (_inTri(verts2D[idx[j]], ia, ib, ic)) { isEar = false; break; }
      }
      if (isEar) { tris.push([ia, ib, ic]); idx.splice(i, 1); cut = true; break; }
    }
    if (!cut) break;
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

export function createGarment() {
  const id = _uid();
  _garments.set(id, { id, patterns: [], seams: [], mesh: null });
  return { ok: true, id };
}

export function addPattern(garmentId, opts) {
  const g = _garments.get(garmentId);
  if (!g) return { ok: false };
  const verts2D = opts?.polygon2D || [[0, 0], [1, 0], [1, 1], [0, 1]];
  const placement = opts?.placement || [0, 1.0, 0];   // 3D world origin
  const normalAxis = opts?.normalAxis || 'z';
  const tris = _ear2D(verts2D);
  const pid = _uid();
  // Convert 2D to 3D vertices.
  const verts3D = verts2D.map(([x, y]) => {
    if (normalAxis === 'x') return [placement[0], placement[1] + y, placement[2] + x];
    if (normalAxis === 'y') return [placement[0] + x, placement[1], placement[2] + y];
    return [placement[0] + x, placement[1] + y, placement[2]];
  });
  g.patterns.push({ uuid: pid, verts2D, verts3D, tris });
  return { ok: true, uuid: pid, vertCount: verts3D.length, triCount: tris.length };
}

export function addSeam(garmentId, patternA, edgeA, patternB, edgeB) {
  // edgeA: [v0, v1] indices in patternA.verts2D; same for edgeB.
  const g = _garments.get(garmentId);
  if (!g) return { ok: false };
  g.seams.push({ patternA, edgeA, patternB, edgeB });
  return { ok: true, seamCount: g.seams.length };
}

function _mergeAndStitch(g) {
  const allVerts = [];
  const allTris = [];
  const patternBaseIdx = new Map();
  for (const p of g.patterns) {
    patternBaseIdx.set(p.uuid, allVerts.length);
    for (const v of p.verts3D) allVerts.push([...v]);
    for (const [a, b, c] of p.tris) {
      const base = patternBaseIdx.get(p.uuid);
      allTris.push([base + a, base + b, base + c]);
    }
  }
  // Apply seams: average matching edge vertices.
  for (const seam of g.seams) {
    const A = g.patterns.find((p) => p.uuid === seam.patternA);
    const B = g.patterns.find((p) => p.uuid === seam.patternB);
    if (!A || !B) continue;
    const baseA = patternBaseIdx.get(A.uuid);
    const baseB = patternBaseIdx.get(B.uuid);
    const aVerts = seam.edgeA.map((i) => baseA + i);
    const bVerts = seam.edgeB.map((i) => baseB + i);
    for (let i = 0; i < Math.min(aVerts.length, bVerts.length); i++) {
      const ia = aVerts[i], ib = bVerts[i];
      const avg = [
        (allVerts[ia][0] + allVerts[ib][0]) / 2,
        (allVerts[ia][1] + allVerts[ib][1]) / 2,
        (allVerts[ia][2] + allVerts[ib][2]) / 2,
      ];
      allVerts[ia] = [...avg]; allVerts[ib] = [...avg];
    }
  }
  return { verts: allVerts, tris: allTris };
}

export function buildMesh(garmentId) {
  const g = _garments.get(garmentId);
  if (!g) return { ok: false };
  const { verts, tris } = _mergeAndStitch(g);
  const positions = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    positions[i * 3] = verts[i][0];
    positions[i * 3 + 1] = verts[i][1];
    positions[i * 3 + 2] = verts[i][2];
  }
  const indices = new Uint32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    indices[i * 3] = tris[i][0];
    indices[i * 3 + 1] = tris[i][1];
    indices[i * 3 + 2] = tris[i][2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xcfb9a4, roughness: 0.85, side: THREE.DoubleSide });
  if (g.mesh && window.__archdiscScene) {
    window.__archdiscScene.remove(g.mesh);
    g.mesh.geometry.dispose();
    g.mesh.material.dispose();
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `garment-${garmentId}`;
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'garment';
  if (window.__archdiscScene) window.__archdiscScene.add(mesh);
  g.mesh = mesh;
  if (typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(mesh); } catch (_) {}
  }
  return { ok: true, uuid: mesh.uuid, verts: verts.length, tris: tris.length };
}

export function drape(garmentId, opts) {
  // Hand the garment mesh to slice-686 cloth solver if installed; else
  // run a quick in-house Verlet drape.
  const g = _garments.get(garmentId);
  if (!g || !g.mesh) return { ok: false };
  if (typeof window.__studioClothAttachMesh === 'function') {
    return window.__studioClothAttachMesh(g.mesh.uuid, opts);
  }
  // In-house Verlet drape (10 iters).
  const iters = Number(opts?.iterations) || 10;
  const gravity = Number(opts?.gravity) || -0.1;
  const pos = g.mesh.geometry.attributes.position;
  const prev = new Float32Array(pos.array);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < pos.count; i++) {
      const px = pos.array[i * 3];
      const py = pos.array[i * 3 + 1];
      const pz = pos.array[i * 3 + 2];
      const dx = px - prev[i * 3];
      const dy = py - prev[i * 3 + 1];
      const dz = pz - prev[i * 3 + 2];
      prev[i * 3] = px; prev[i * 3 + 1] = py; prev[i * 3 + 2] = pz;
      pos.array[i * 3] = px + dx * 0.99;
      pos.array[i * 3 + 1] = py + dy * 0.99 + gravity;
      pos.array[i * 3 + 2] = pz + dz * 0.99;
      if (pos.array[i * 3 + 1] < 0) pos.array[i * 3 + 1] = 0;
    }
  }
  pos.needsUpdate = true;
  g.mesh.geometry.computeVertexNormals();
  return { ok: true, iters };
}

export function listGarments() {
  return {
    ok: true,
    garments: Array.from(_garments.values()).map((g) => ({
      id: g.id, patterns: g.patterns.length, seams: g.seams.length, hasMesh: !!g.mesh,
    })),
  };
}
