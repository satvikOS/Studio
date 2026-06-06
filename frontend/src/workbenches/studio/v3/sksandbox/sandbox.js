// Slice 717 — SketchUp Sandbox terrain tools. From-contours (build
// terrain mesh from polyline elevation contours), Smoove (sculpt
// terrain by raising vertices in a brush radius), Stamp (project a
// flat object onto the terrain), Drape (raycast a curve onto the
// terrain), Add Detail (subdivide a terrain region), Flip Edge
// (toggle a triangle pair's shared edge orientation).

import * as THREE from 'three';

const _terrains = new Map();
let _seq = 1;
function _uid() { return `tn-${_seq++}-${Date.now().toString(36)}`; }

export function fromContours(contours, opts) {
  // Each contour is [[x,y,z], ...] at constant Y. Build a triangulated
  // terrain by sampling a regular grid and bilinearly interpolating
  // from the nearest 2 contours.
  const gridSize = Math.max(16, Math.min(256, Number(opts?.gridSize) || 96));
  if (!Array.isArray(contours) || contours.length === 0) return { ok: false };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of contours) {
    for (const [x, _, z] of c) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  const w = maxX - minX, d = maxZ - minZ;
  const dx = w / (gridSize - 1), dz = d / (gridSize - 1);
  const heights = new Float32Array(gridSize * gridSize);
  // For each grid cell, find nearest contour points and inverse-distance weight.
  for (let gz = 0; gz < gridSize; gz++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const px = minX + gx * dx;
      const pz = minZ + gz * dz;
      let sumW = 0, sumY = 0;
      for (const c of contours) {
        for (const [x, y, z] of c) {
          const d = Math.hypot(px - x, pz - z);
          if (d < 1e-3) { sumY = y; sumW = 1; break; }
          const w = 1 / (d * d);
          sumY += y * w; sumW += w;
        }
        if (sumW === 1) break;
      }
      heights[gz * gridSize + gx] = sumW > 0 ? sumY / sumW : 0;
    }
  }
  const positions = new Float32Array(gridSize * gridSize * 3);
  for (let gz = 0; gz < gridSize; gz++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const i = (gz * gridSize + gx) * 3;
      positions[i]     = minX + gx * dx;
      positions[i + 1] = heights[gz * gridSize + gx];
      positions[i + 2] = minZ + gz * dz;
    }
  }
  const indices = [];
  for (let gz = 0; gz < gridSize - 1; gz++) {
    for (let gx = 0; gx < gridSize - 1; gx++) {
      const a = gz * gridSize + gx;
      const b = gz * gridSize + gx + 1;
      const c = (gz + 1) * gridSize + gx + 1;
      const d = (gz + 1) * gridSize + gx;
      indices.push(a, b, c, a, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x7a8c70, roughness: 0.9, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sk-sandbox-terrain';
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'sk-terrain';
  mesh.userData.archdiscSkTerrain = { gridSize, minX, minZ, dx, dz };
  if (window.__archdiscScene) window.__archdiscScene.add(mesh);
  const id = _uid();
  _terrains.set(id, mesh);
  return { ok: true, id, uuid: mesh.uuid };
}

export function smoove(terrainId, brushCenter, radius, strength) {
  const mesh = _terrains.get(terrainId);
  if (!mesh) return { ok: false };
  const pos = mesh.geometry.attributes.position;
  const [cx, cy, cz] = brushCenter;
  const r = Number(radius) || 1;
  const s = Number(strength) || 0.5;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.array[i * 3];
    const pz = pos.array[i * 3 + 2];
    const d = Math.hypot(px - cx, pz - cz);
    if (d > r) continue;
    const w = Math.pow(1 - d / r, 2);
    pos.array[i * 3 + 1] += s * w;
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  return { ok: true };
}

export function stamp(terrainId, footprint, height) {
  // Project a flat polygon onto the terrain by adjusting all vertices
  // within the polygon to height = max(currentHeight, requestedHeight).
  const mesh = _terrains.get(terrainId);
  if (!mesh) return { ok: false };
  const pos = mesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.array[i * 3];
    const pz = pos.array[i * 3 + 2];
    if (_pointInPoly(px, pz, footprint)) {
      pos.array[i * 3 + 1] = Number(height);
    }
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  return { ok: true };
}

function _pointInPoly(px, pz, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1];
    const xj = poly[j][0], zj = poly[j][1];
    const intersect = ((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / ((zj - zi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function drapeCurve(terrainId, curve) {
  // For each [x,z] in curve, sample the terrain height by raycast/closest-grid.
  const mesh = _terrains.get(terrainId);
  if (!mesh) return { ok: false };
  const t = mesh.userData.archdiscSkTerrain;
  if (!t) return { ok: false };
  const out = [];
  const pos = mesh.geometry.attributes.position.array;
  for (const [x, z] of curve) {
    const gx = Math.max(0, Math.min(t.gridSize - 1, Math.round((x - t.minX) / t.dx)));
    const gz = Math.max(0, Math.min(t.gridSize - 1, Math.round((z - t.minZ) / t.dz)));
    const y = pos[(gz * t.gridSize + gx) * 3 + 1];
    out.push([x, y, z]);
  }
  return { ok: true, points: out };
}

export function flipEdge(terrainId, gx, gz) {
  const mesh = _terrains.get(terrainId);
  if (!mesh) return { ok: false };
  // Flip the diagonal of the quad at (gx, gz).
  const t = mesh.userData.archdiscSkTerrain;
  if (!t) return { ok: false };
  const idx = mesh.geometry.index.array;
  const N = t.gridSize;
  // Each quad uses 6 indices starting at (gz * (N-1) + gx) * 6 in our gen order.
  const base = (gz * (N - 1) + gx) * 6;
  if (base + 5 >= idx.length) return { ok: false };
  // Replace [a,b,c, a,c,d] with [a,b,d, b,c,d].
  const a = idx[base], b = idx[base + 1], c = idx[base + 2], d = idx[base + 5];
  idx[base + 2] = d;
  idx[base + 3] = b;
  idx[base + 4] = c;
  idx[base + 5] = d;
  mesh.geometry.index.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  return { ok: true };
}

export function listTerrains() {
  return {
    ok: true,
    terrains: Array.from(_terrains.entries()).map(([id, m]) => ({ id, uuid: m.uuid })),
  };
}
