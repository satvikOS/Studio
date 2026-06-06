// Slice 719 — UV island packing. Finds disjoint UV islands on a
// mesh (via edge connectivity in UV space), computes each island's
// 2D bounding box, then packs them into the [0,1] UV space using a
// first-fit decreasing-area shelf algorithm. Mirrors Blender / Maya
// "Pack Islands" + "Lay Out".

import * as THREE from 'three';

function _findIslands(mesh) {
  const idx = mesh.geometry.index?.array;
  const pos = mesh.geometry.attributes.position;
  const uv = mesh.geometry.attributes.uv;
  if (!uv) return null;
  const triCount = idx ? idx.length / 3 : pos.count / 3;
  // Build edges: triangles sharing a UV edge are in the same island.
  // Use canonical vertex IDs (rounded UV pair).
  const uvKey = (i) => `${uv.array[i * 2].toFixed(5)}|${uv.array[i * 2 + 1].toFixed(5)}`;
  const triToIsland = new Int32Array(triCount).fill(-1);
  let nextIsland = 0;
  // Build adjacency: tri i and tri j share an edge if they share 2 verts.
  const triVerts = [];
  for (let t = 0; t < triCount; t++) {
    if (idx) triVerts.push([idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]]);
    else triVerts.push([t * 3, t * 3 + 1, t * 3 + 2]);
  }
  // For each UV vertex key, list of triangles using it.
  const keyToTris = new Map();
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const key = uvKey(triVerts[t][k]);
      if (!keyToTris.has(key)) keyToTris.set(key, []);
      keyToTris.get(key).push(t);
    }
  }
  for (let t = 0; t < triCount; t++) {
    if (triToIsland[t] !== -1) continue;
    // BFS.
    const stack = [t];
    triToIsland[t] = nextIsland;
    while (stack.length) {
      const cur = stack.pop();
      for (let k = 0; k < 3; k++) {
        const key = uvKey(triVerts[cur][k]);
        const neighbors = keyToTris.get(key) || [];
        for (const nt of neighbors) {
          if (triToIsland[nt] === -1) {
            triToIsland[nt] = nextIsland;
            stack.push(nt);
          }
        }
      }
    }
    nextIsland++;
  }
  // Build per-island vertex sets + bounding boxes.
  const islands = Array.from({ length: nextIsland }, () => ({
    triIndices: [],
    vertSet: new Set(),
    minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity,
  }));
  for (let t = 0; t < triCount; t++) {
    const isl = islands[triToIsland[t]];
    isl.triIndices.push(t);
    for (let k = 0; k < 3; k++) {
      const vi = triVerts[t][k];
      isl.vertSet.add(vi);
      const u = uv.array[vi * 2], v = uv.array[vi * 2 + 1];
      if (u < isl.minU) isl.minU = u;
      if (u > isl.maxU) isl.maxU = u;
      if (v < isl.minV) isl.minV = v;
      if (v > isl.maxV) isl.maxV = v;
    }
  }
  return islands;
}

function _pack(islands, margin) {
  // First-fit decreasing-area shelf packing into [0,1].
  islands.sort((a, b) => ((b.maxU - b.minU) * (b.maxV - b.minV)) - ((a.maxU - a.minU) * (a.maxV - a.minV)));
  let shelfY = margin;
  let shelfH = 0;
  let shelfX = margin;
  const placements = new Map();
  for (const isl of islands) {
    const w = (isl.maxU - isl.minU) + margin * 2;
    const h = (isl.maxV - isl.minV) + margin * 2;
    if (shelfX + w > 1) {
      shelfX = margin;
      shelfY += shelfH;
      shelfH = 0;
    }
    if (shelfY + h > 1) {
      // Overflow — scale down by 2.
      for (const isl2 of islands) {
        const p = placements.get(isl2) || { tx: 0, ty: 0, sx: 1, sy: 1 };
        p.sx *= 0.5; p.sy *= 0.5;
        placements.set(isl2, p);
      }
      shelfY = margin;
      shelfH = 0;
      shelfX = margin;
    }
    placements.set(isl, { tx: shelfX, ty: shelfY, sx: 1, sy: 1, srcMinU: isl.minU, srcMinV: isl.minV });
    shelfX += w;
    if (h > shelfH) shelfH = h;
  }
  return placements;
}

export function packIslands(meshUuid, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry?.attributes?.uv) return { ok: false };
  const islands = _findIslands(mesh);
  if (!islands) return { ok: false };
  const margin = Number(opts?.margin) || 0.01;
  const placements = _pack(islands, margin);
  // Apply: move each vertex's UV by the placement of its island.
  const uv = mesh.geometry.attributes.uv;
  for (const [isl, p] of placements.entries()) {
    for (const vi of isl.vertSet) {
      const u = uv.array[vi * 2];
      const v = uv.array[vi * 2 + 1];
      uv.array[vi * 2]     = (u - p.srcMinU) * p.sx + p.tx;
      uv.array[vi * 2 + 1] = (v - p.srcMinV) * p.sy + p.ty;
    }
  }
  uv.needsUpdate = true;
  return { ok: true, islandCount: islands.length };
}

export function listIslands(meshUuid) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry?.attributes?.uv) return { ok: false };
  const islands = _findIslands(mesh);
  if (!islands) return { ok: false };
  return {
    ok: true,
    islands: islands.map((i, idx) => ({
      idx, triCount: i.triIndices.length, vertCount: i.vertSet.size,
      bbox: [i.minU, i.minV, i.maxU, i.maxV],
    })),
  };
}

// Lay Out — just place all islands on a single row (debugging aid).
export function layOut(meshUuid) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry?.attributes?.uv) return { ok: false };
  const islands = _findIslands(mesh);
  if (!islands) return { ok: false };
  let cursorU = 0.02;
  const placements = new Map();
  for (const isl of islands) {
    placements.set(isl, { tx: cursorU, ty: 0.02, sx: 1, sy: 1, srcMinU: isl.minU, srcMinV: isl.minV });
    cursorU += (isl.maxU - isl.minU) + 0.02;
  }
  const uv = mesh.geometry.attributes.uv;
  for (const [isl, p] of placements.entries()) {
    for (const vi of isl.vertSet) {
      const u = uv.array[vi * 2];
      const v = uv.array[vi * 2 + 1];
      uv.array[vi * 2]     = (u - p.srcMinU) + p.tx;
      uv.array[vi * 2 + 1] = (v - p.srcMinV) + p.ty;
    }
  }
  uv.needsUpdate = true;
  return { ok: true };
}
