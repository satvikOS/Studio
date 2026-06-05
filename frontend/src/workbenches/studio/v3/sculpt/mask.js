// ArchDisc Studio V3 — per-vertex sculpt mask.
//
// A mask is a Float32Array (one float per vertex) stored on
// `mesh.userData.archdiscStudioSculptMask`. 0 = unmasked, 1 =
// fully masked. The brush respects this: `brush * (1 - mask)`.
//
// Ops:
//   ensureMask(mesh)                     → returns the Float32Array
//   maskPaint(mesh, point, radius, str)  → paints in a sphere
//   maskInvert(mesh)
//   maskClear(mesh)
//   maskBlur(mesh, iters=1)              → laplacian, vertex-neighbour
//   maskGrow(mesh, radius)
//   maskShrink(mesh, radius)
//
// Vertex neighbours for the blur pass are inferred from the index
// buffer (every edge of every triangle = a neighbour pair). For
// non-indexed geometry we fall back to a radius-based neighbour
// search keyed off geometry's bounding sphere size.

import * as THREE from 'three';

export const MASK_KEY = 'archdiscStudioSculptMask';

export function ensureMask(mesh) {
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return null;
  mesh.userData = mesh.userData || {};
  const pc = mesh.geometry.attributes.position.count;
  let m = mesh.userData[MASK_KEY];
  if (!(m instanceof Float32Array) || m.length !== pc) {
    m = new Float32Array(pc);
    mesh.userData[MASK_KEY] = m;
  }
  return m;
}

export function getMask(mesh) {
  if (!mesh || !mesh.userData) return null;
  const m = mesh.userData[MASK_KEY];
  return m instanceof Float32Array ? m : null;
}

export function maskClear(mesh) {
  const m = ensureMask(mesh);
  if (!m) return { ok: false, error: 'no mask' };
  m.fill(0);
  return { ok: true, count: m.length };
}

export function maskInvert(mesh) {
  const m = ensureMask(mesh);
  if (!m) return { ok: false, error: 'no mask' };
  for (let i = 0; i < m.length; i++) m[i] = 1 - m[i];
  return { ok: true, count: m.length };
}

export function maskPaint(mesh, point, radius, strength) {
  const m = ensureMask(mesh);
  if (!m) return { ok: false, error: 'no mask' };
  const pos = mesh.geometry.attributes.position;
  const p = Array.isArray(point) ? point : [0, 0, 0];
  const r = Math.max(1e-6, Number(radius) || 0.1);
  const s = Math.min(1, Math.max(0, Number(strength) || 1));
  const r2 = r * r;
  let painted = 0;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - p[0];
    const dy = pos.getY(i) - p[1];
    const dz = pos.getZ(i) - p[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    const t = 1 - Math.sqrt(d2) / r;
    // additive painting up to 1
    const add = s * t;
    if (m[i] < 1) {
      m[i] = Math.min(1, m[i] + add);
      painted++;
    }
  }
  return { ok: true, painted };
}

// Build a vertex-neighbour table from the index buffer.
function buildNeighbours(geom) {
  const pc = geom.attributes.position.count;
  const adj = new Array(pc);
  for (let i = 0; i < pc; i++) adj[i] = new Set();
  const idx = geom.index;
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
      adj[a].add(b); adj[a].add(c);
      adj[b].add(a); adj[b].add(c);
      adj[c].add(a); adj[c].add(b);
    }
  } else {
    // non-indexed: every consecutive triplet is a triangle
    for (let i = 0; i < pc; i += 3) {
      const a = i, b = i + 1, c = i + 2;
      if (b >= pc || c >= pc) break;
      adj[a].add(b); adj[a].add(c);
      adj[b].add(a); adj[b].add(c);
      adj[c].add(a); adj[c].add(b);
    }
  }
  // convert to typed arrays for speed
  return adj.map((s) => new Uint32Array(s));
}

export function maskBlur(mesh, iters) {
  const m = ensureMask(mesh);
  if (!m) return { ok: false, error: 'no mask' };
  const adj = buildNeighbours(mesh.geometry);
  const n = Math.max(1, iters | 0);
  let tmp = new Float32Array(m.length);
  for (let it = 0; it < n; it++) {
    for (let i = 0; i < m.length; i++) {
      const neigh = adj[i];
      if (!neigh.length) { tmp[i] = m[i]; continue; }
      let sum = m[i];
      for (let j = 0; j < neigh.length; j++) sum += m[neigh[j]];
      tmp[i] = sum / (neigh.length + 1);
    }
    // swap
    const t = m.slice();
    m.set(tmp);
    tmp = t;
  }
  return { ok: true, count: m.length, iters: n };
}

// Grow: a vertex inherits any non-zero mask from a neighbour within
// `radius` (vertex-distance). Effectively dilates the masked area.
export function maskGrow(mesh, radius) {
  const m = ensureMask(mesh);
  if (!m) return { ok: false, error: 'no mask' };
  const pos = mesh.geometry.attributes.position;
  const r = Math.max(1e-6, Number(radius) || 0.05);
  const r2 = r * r;
  const next = new Float32Array(m);
  let grown = 0;
  // Build coarse spatial grid? For simplicity use O(n²) — sculpt
  // meshes after DynaMesh are bounded in vertex count.
  for (let i = 0; i < pos.count; i++) {
    if (m[i] > 0.99) continue;
    const ix = pos.getX(i), iy = pos.getY(i), iz = pos.getZ(i);
    let maxN = m[i];
    for (let j = 0; j < pos.count; j++) {
      if (j === i || m[j] <= 0) continue;
      const dx = pos.getX(j) - ix;
      const dy = pos.getY(j) - iy;
      const dz = pos.getZ(j) - iz;
      if (dx * dx + dy * dy + dz * dz <= r2) {
        if (m[j] > maxN) maxN = m[j];
      }
    }
    if (maxN > m[i]) { next[i] = maxN; grown++; }
  }
  m.set(next);
  return { ok: true, grown, radius: r };
}

// Shrink: every vertex within `radius` of an unmasked vertex loses
// its mask (set to 0). Effectively erodes.
export function maskShrink(mesh, radius) {
  const m = ensureMask(mesh);
  if (!m) return { ok: false, error: 'no mask' };
  const pos = mesh.geometry.attributes.position;
  const r = Math.max(1e-6, Number(radius) || 0.05);
  const r2 = r * r;
  const next = new Float32Array(m);
  let shrunk = 0;
  for (let i = 0; i < pos.count; i++) {
    if (m[i] <= 0) continue;
    const ix = pos.getX(i), iy = pos.getY(i), iz = pos.getZ(i);
    for (let j = 0; j < pos.count; j++) {
      if (j === i) continue;
      if (m[j] > 0.01) continue;
      const dx = pos.getX(j) - ix;
      const dy = pos.getY(j) - iy;
      const dz = pos.getZ(j) - iz;
      if (dx * dx + dy * dy + dz * dz <= r2) {
        next[i] = 0;
        shrunk++;
        break;
      }
    }
  }
  m.set(next);
  return { ok: true, shrunk, radius: r };
}

// Re-export the THREE namespace tag to make the module testable in
// isolation (rare — but Three-using suites sometimes need a sanity
// import).
export const _THREE_TAG = THREE.REVISION;
