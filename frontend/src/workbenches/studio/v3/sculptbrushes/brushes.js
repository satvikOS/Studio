// ArchDisc Studio V3 — 25+ sculpt brush algorithms.
//
// Each brush is a pure function `(mesh, point, radius, strength, opts)`
// that mutates the mesh's `position` attribute in place. The contract
// matches the slice-684 brush patcher: `point` is local-space [x,y,z],
// `radius` is the brush footprint, `strength` is the [0..1] multiplier
// (some brushes treat it as a height in world units). Every brush
// returns `{ ok, touched, ... }` with at minimum a `touched` count of
// vertices it actually moved, so callers/tests can assert work was
// done without re-walking the mesh.
//
// Design rules:
//   1. NO external deps beyond three (window.THREE is fine in tests).
//   2. NO writes outside `mesh.geometry.attributes.position`. (The
//      patcher hooks normal recompute, BVH refresh, undo, etc.)
//   3. Every brush respects a smoothstep falloff inside its radius.
//   4. Brushes that need a stroke direction or alpha pull it from
//      `opts` (`direction: [dx,dy,dz]`, `alpha: name`) — never from
//      module globals.
//   5. Math is per-vertex Euclidean; no neighbour-table builds inside
//      the inner loop. (Polish/Smooth are the exception; they accept
//      the O(n²) cost for the local radius.)
//
// The "alpha" param is the alpha *name* (string). When supplied, the
// brush samples the alpha texture for each affected vertex by
// projecting (vert-point) onto a planar XZ UV scaled by `radius` and
// multiplies the per-vertex falloff by that weight. Importing alpha
// would create a cycle into the slice-684 module; instead we read
// `window.__studioSculptAlphaSample` if present (it is — slice 684
// installs it at autoload). Missing → weight = 1.
//
// Likewise the "mask" hook is read from
// `mesh.userData.archdiscStudioSculptMask` (the slice-684 mask key).
// Missing → no masking.

import * as THREE from 'three';

const MASK_KEY = 'archdiscStudioSculptMask';

// ── helpers ──────────────────────────────────────────────────────────

function _alphaWeight(name, u, v) {
  if (!name) return 1;
  if (typeof window === 'undefined') return 1;
  const fn = window.__studioSculptAlphaSample;
  if (typeof fn !== 'function') return 1;
  const prevActive = (window.__studioSculptActiveAlpha && window.__studioSculptActiveAlpha()) || null;
  // Temporarily switch alpha if a name was supplied that's not active.
  let switched = false;
  if (prevActive !== name && typeof window.__studioSculptAlphaSet === 'function') {
    try { window.__studioSculptAlphaSet(name); switched = true; } catch (_) {}
  }
  let w = 1;
  try {
    const r = fn(u, v);
    if (r && typeof r.weight === 'number' && Number.isFinite(r.weight)) w = r.weight;
  } catch (_) {}
  if (switched) {
    try { window.__studioSculptAlphaSet(prevActive); } catch (_) {}
  }
  return w;
}

function _mask(mesh) {
  if (!mesh || !mesh.userData) return null;
  const m = mesh.userData[MASK_KEY];
  return (m instanceof Float32Array) ? m : null;
}

function _asPoint(p) {
  if (!p) return [0, 0, 0];
  if (Array.isArray(p)) return [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0];
  if (typeof p.x === 'number') return [p.x, p.y || 0, p.z || 0];
  return [0, 0, 0];
}

function _ensureNormal(mesh) {
  let n = mesh.geometry.attributes.normal;
  if (!n) {
    mesh.geometry.computeVertexNormals();
    n = mesh.geometry.attributes.normal;
  }
  return n;
}

// Smoothstep-style falloff curve: 1 at centre, 0 at radius.
// Wraps common/brush.js so multiple modules share the same primitive.
import { smoothFalloff as _smoothFalloff } from '../common/brush.js';
function _falloff(t) { return _smoothFalloff(t); }

function _commit(mesh) {
  const g = mesh.geometry;
  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();
  if (g.boundsTree && typeof g.computeBoundsTree === 'function') {
    try { g.computeBoundsTree(); } catch (_) {}
  }
  g.computeBoundingBox && g.computeBoundingBox();
  g.computeBoundingSphere && g.computeBoundingSphere();
}

// Project (dx,dz) into a [0..1] UV box of side 2r around the centre.
function _planarUV(dx, dz, r) {
  const u = (dx / (2 * r)) + 0.5;
  const v = (dz / (2 * r)) + 0.5;
  return [u, v];
}

// Compute the average normal of all verts within `radius` of `p`.
// Used as the "stroke plane" normal for clay/scrape/fill/flatten.
function _planeFit(mesh, p, r) {
  const pos = mesh.geometry.attributes.position;
  const nrm = _ensureNormal(mesh);
  const r2 = r * r;
  let nx = 0, ny = 0, nz = 0;
  let cx = 0, cy = 0, cz = 0;
  let count = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    if (ddx * ddx + ddy * ddy + ddz * ddz > r2) continue;
    nx += nrm.getX(i); ny += nrm.getY(i); nz += nrm.getZ(i);
    cx += vx; cy += vy; cz += vz;
    count++;
  }
  if (count === 0) return { ok: false };
  const len = Math.hypot(nx, ny, nz) || 1;
  return {
    ok: true,
    count,
    centroid: [cx / count, cy / count, cz / count],
    normal: [nx / len, ny / len, nz / len],
  };
}

// Build neighbour adjacency (one-shot) for Polish/Smooth.
function _adj(geom) {
  const pc = geom.attributes.position.count;
  const sets = new Array(pc);
  for (let i = 0; i < pc; i++) sets[i] = new Set();
  const idx = geom.index;
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
      sets[a].add(b); sets[a].add(c);
      sets[b].add(a); sets[b].add(c);
      sets[c].add(a); sets[c].add(b);
    }
  } else {
    for (let i = 0; i + 2 < pc; i += 3) {
      sets[i].add(i + 1); sets[i].add(i + 2);
      sets[i + 1].add(i); sets[i + 1].add(i + 2);
      sets[i + 2].add(i); sets[i + 2].add(i + 1);
    }
  }
  return sets.map((s) => Uint32Array.from(s));
}

// ── 1. Clay ───────────────────────────────────────────────────────────
// Flatten high points + push everything toward the stroke plane along
// its normal. ZBrush's bread-and-butter additive brush.
export function clay(mesh, point, radius = 0.1, strength = 0.5, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(-1, Math.min(1, strength));
  const plane = _planeFit(mesh, p, r);
  if (!plane.ok) return { ok: true, touched: 0 };
  const [nx, ny, nz] = plane.normal;
  const [cx, cy, cz] = plane.centroid;
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    let w = _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    // Signed distance to the stroke plane through centroid:
    const sd = (vx - cx) * nx + (vy - cy) * ny + (vz - cz) * nz;
    // Push away from plane in normal direction by (strength * r * w).
    const push = s * r * w * 0.5;
    // Flatten contribution: nudge vertex toward plane.
    const flatten = -sd * w * 0.5;
    pos.setXYZ(i, vx + nx * (push + flatten), vy + ny * (push + flatten), vz + nz * (push + flatten));
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched, plane };
}

// ── 2. ClayStrips ─────────────────────────────────────────────────────
// Clay with alternating stripe alpha so the build-up looks like
// finger-dragged strips of clay.
export function clayStrips(mesh, point, radius = 0.1, strength = 0.5, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(-1, Math.min(1, strength));
  const plane = _planeFit(mesh, p, r);
  if (!plane.ok) return { ok: true, touched: 0 };
  const [nx, ny, nz] = plane.normal;
  const [cx, cy, cz] = plane.centroid;
  const mask = _mask(mesh);
  let touched = 0;
  // Stripe direction is whatever axis is most perpendicular to the
  // plane normal — pick world X if normal is mostly Y/Z, else Y.
  let ax = 1, ay = 0, az = 0;
  if (Math.abs(nx) > 0.7) { ax = 0; ay = 1; az = 0; }
  // Stripe spacing: 8 stripes across the brush diameter.
  const STRIPES = 8;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    let w = _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    // Stripe gate: projection onto stripe axis → on/off pattern.
    const dot = (ddx * ax + ddy * ay + ddz * az) / r; // [-1..1]
    const frac = ((dot * STRIPES) + STRIPES) % 1;
    if (frac > 0.6) continue;
    const stripeW = 1 - frac / 0.6;
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    w *= stripeW;
    if (w === 0) continue;
    const sd = (vx - cx) * nx + (vy - cy) * ny + (vz - cz) * nz;
    const push = s * r * w * 0.5;
    const flatten = -sd * w * 0.5;
    pos.setXYZ(i, vx + nx * (push + flatten), vy + ny * (push + flatten), vz + nz * (push + flatten));
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched, stripes: STRIPES };
}

// ── 3. Crease ─────────────────────────────────────────────────────────
// Sharp inward fold: pinch toward centre AND displace negatively along
// normal. The pinch creates a tight crease line.
export function crease(mesh, point, radius = 0.08, strength = 0.6, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const nrm = _ensureNormal(mesh);
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(0, Math.min(1, strength));
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    let w = _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    // Pinch: pull toward stroke point (sharp, quadratic).
    const pinch = w * w * s * 0.6;
    let nxv = -ddx * pinch, nyv = -ddy * pinch, nzv = -ddz * pinch;
    // Inward normal displacement.
    const inDisp = -w * s * r * 0.4;
    nxv += nrm.getX(i) * inDisp;
    nyv += nrm.getY(i) * inDisp;
    nzv += nrm.getZ(i) * inDisp;
    pos.setXYZ(i, vx + nxv, vy + nyv, vz + nzv);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched };
}

// ── 4. Scrape ─────────────────────────────────────────────────────────
// Flatten by pushing high points DOWN to the stroke plane. Doesn't
// touch low points. Carves bevels.
export function scrape(mesh, point, radius = 0.1, strength = 0.7, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(0, Math.min(1, strength));
  const plane = _planeFit(mesh, p, r);
  if (!plane.ok) return { ok: true, touched: 0 };
  const [nx, ny, nz] = plane.normal;
  const [cx, cy, cz] = plane.centroid;
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    const sd = (vx - cx) * nx + (vy - cy) * ny + (vz - cz) * nz;
    if (sd <= 0) continue; // only push HIGH points
    let w = _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    const k = -sd * w * s;
    pos.setXYZ(i, vx + nx * k, vy + ny * k, vz + nz * k);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched };
}

// ── 5. Fill ───────────────────────────────────────────────────────────
// Inverse of Scrape: push LOW points up to the stroke plane.
export function fill(mesh, point, radius = 0.1, strength = 0.7, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(0, Math.min(1, strength));
  const plane = _planeFit(mesh, p, r);
  if (!plane.ok) return { ok: true, touched: 0 };
  const [nx, ny, nz] = plane.normal;
  const [cx, cy, cz] = plane.centroid;
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    const sd = (vx - cx) * nx + (vy - cy) * ny + (vz - cz) * nz;
    if (sd >= 0) continue; // only push LOW points
    let w = _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    const k = -sd * w * s;
    pos.setXYZ(i, vx + nx * k, vy + ny * k, vz + nz * k);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched };
}

// ── 6. Pinch ──────────────────────────────────────────────────────────
// Pull every affected vertex toward the stroke point.
export function pinch(mesh, point, radius = 0.08, strength = 0.5, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(-1, Math.min(1, strength));
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r || d < 1e-9) continue;
    let w = _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    const k = -w * s * 0.6;
    pos.setXYZ(i, vx + ddx * k, vy + ddy * k, vz + ddz * k);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched };
}

// ── 7. Inflate ────────────────────────────────────────────────────────
// Push along each vertex's normal. `opts.variance` lets each vertex
// scale its push pseudo-randomly (seeded by index).
export function inflate(mesh, point, radius = 0.1, strength = 0.5, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const nrm = _ensureNormal(mesh);
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(-1, Math.min(1, strength));
  const variance = Math.max(0, Math.min(1, opts.variance == null ? 0 : opts.variance));
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    let w = _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    // Pseudo-random per-vertex modulation.
    if (variance > 0) {
      const h = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      const noise = (h - Math.floor(h));
      w *= (1 - variance) + variance * noise;
    }
    if (w === 0) continue;
    const k = s * r * w * 0.5;
    pos.setXYZ(i, vx + nrm.getX(i) * k, vy + nrm.getY(i) * k, vz + nrm.getZ(i) * k);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched, variance };
}

// ── 8. Magnify ────────────────────────────────────────────────────────
// Radial scale outward from stroke centre. Verts move along (v-p)
// proportional to their distance — like a lens.
export function magnify(mesh, point, radius = 0.1, strength = 0.5, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(-1, Math.min(1, strength));
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r || d < 1e-9) continue;
    let w = _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    const k = w * s * 0.5; // scale factor
    pos.setXYZ(i, vx + ddx * k, vy + ddy * k, vz + ddz * k);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched };
}

// ── 9. Polish ─────────────────────────────────────────────────────────
// Laplacian smooth limited to the brush region (no global smoothing).
export function polish(mesh, point, radius = 0.1, strength = 0.5, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(0, Math.min(1, strength));
  const adj = _adj(mesh.geometry);
  const original = new Float32Array(pos.array);
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = original[i * 3], vy = original[i * 3 + 1], vz = original[i * 3 + 2];
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    let w = _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    const neigh = adj[i];
    if (!neigh.length) continue;
    let ax = 0, ay = 0, az = 0;
    for (let j = 0; j < neigh.length; j++) {
      const ni = neigh[j];
      ax += original[ni * 3];
      ay += original[ni * 3 + 1];
      az += original[ni * 3 + 2];
    }
    ax /= neigh.length; ay /= neigh.length; az /= neigh.length;
    const k = w * s;
    pos.setXYZ(i, vx + (ax - vx) * k, vy + (ay - vy) * k, vz + (az - vz) * k);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched };
}

// ── 10. Flatten ───────────────────────────────────────────────────────
// Project every vert in the radius onto the stroke plane (works on
// both high and low points).
export function flatten(mesh, point, radius = 0.1, strength = 0.5, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(0, Math.min(1, strength));
  const plane = _planeFit(mesh, p, r);
  if (!plane.ok) return { ok: true, touched: 0 };
  const [nx, ny, nz] = plane.normal;
  const [cx, cy, cz] = plane.centroid;
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    let w = _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    const sd = (vx - cx) * nx + (vy - cy) * ny + (vz - cz) * nz;
    const k = -sd * w * s;
    pos.setXYZ(i, vx + nx * k, vy + ny * k, vz + nz * k);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched };
}

// ── 11. SnakeHook ─────────────────────────────────────────────────────
// Drag vertices toward a moving target point. `opts.target` = [tx,ty,tz];
// without one, uses (point + opts.direction * radius).
export function snakeHook(mesh, point, radius = 0.1, strength = 0.5, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(0, Math.min(1, strength));
  let target = Array.isArray(opts.target) ? opts.target : null;
  const dir = Array.isArray(opts.direction) ? opts.direction : [0, 1, 0];
  if (!target) {
    const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    target = [p[0] + dir[0] / dl * r, p[1] + dir[1] / dl * r, p[2] + dir[2] / dl * r];
  }
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    let w = _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    const k = w * s;
    pos.setXYZ(
      i,
      vx + (target[0] - vx) * k,
      vy + (target[1] - vy) * k,
      vz + (target[2] - vz) * k,
    );
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched, target };
}

// ── 12. Grab ──────────────────────────────────────────────────────────
// Translate every vert in the brush region by a fixed offset vector.
export function grab(mesh, point, radius = 0.1, strength = 1, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(-2, Math.min(2, strength));
  const off = Array.isArray(opts.offset) ? opts.offset
    : Array.isArray(opts.direction) ? opts.direction
    : [0, r * 0.5, 0];
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    let w = _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    pos.setXYZ(i, vx + off[0] * w * s, vy + off[1] * w * s, vz + off[2] * w * s);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched, offset: off };
}

// ── 13. Thumb ─────────────────────────────────────────────────────────
// Shear push tangential to the surface — vertices slide along the
// tangent plane rather than into/out of the surface.
export function thumb(mesh, point, radius = 0.1, strength = 0.5, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const nrm = _ensureNormal(mesh);
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(-1, Math.min(1, strength));
  const dir = Array.isArray(opts.direction) ? opts.direction : [1, 0, 0];
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const dx = dir[0] / dl, dy = dir[1] / dl, dz = dir[2] / dl;
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    let w = _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    // Project dir onto the tangent plane: dir - (dir·n)n.
    const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
    const dn = dx * nx + dy * ny + dz * nz;
    const tx = dx - dn * nx;
    const ty = dy - dn * ny;
    const tz = dz - dn * nz;
    const k = w * s * r * 0.5;
    pos.setXYZ(i, vx + tx * k, vy + ty * k, vz + tz * k);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched };
}

// ── 14. Nudge ─────────────────────────────────────────────────────────
// Small translation in stroke direction (radius-scaled).
export function nudge(mesh, point, radius = 0.05, strength = 0.3, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(-1, Math.min(1, strength));
  const dir = Array.isArray(opts.direction) ? opts.direction : [1, 0, 0];
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const dx = dir[0] / dl, dy = dir[1] / dl, dz = dir[2] / dl;
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    let w = _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    const k = w * s * r * 0.25;
    pos.setXYZ(i, vx + dx * k, vy + dy * k, vz + dz * k);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched };
}

// ── 15. Rotate ────────────────────────────────────────────────────────
// Rotate verts around stroke point by `strength * π` radians, around
// an axis (opts.axis or +Y).
export function rotate(mesh, point, radius = 0.1, strength = 0.25, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(-2, Math.min(2, strength));
  const axis = Array.isArray(opts.axis) ? opts.axis : [0, 1, 0];
  const al = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const ax = axis[0] / al, ay = axis[1] / al, az = axis[2] / al;
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    let w = _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    const ang = s * Math.PI * w;
    const c = Math.cos(ang), si = Math.sin(ang);
    // Rodrigues rotation:
    const dot = ddx * ax + ddy * ay + ddz * az;
    const cx = ay * ddz - az * ddy;
    const cy = az * ddx - ax * ddz;
    const cz = ax * ddy - ay * ddx;
    const rx = ddx * c + cx * si + ax * dot * (1 - c);
    const ry = ddy * c + cy * si + ay * dot * (1 - c);
    const rz = ddz * c + cz * si + az * dot * (1 - c);
    pos.setXYZ(i, p[0] + rx, p[1] + ry, p[2] + rz);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched };
}

// ── 16. Twist ─────────────────────────────────────────────────────────
// Rotate proportionally to distance from centre (twist along an axis).
export function twist(mesh, point, radius = 0.1, strength = 0.5, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(-2, Math.min(2, strength));
  const axis = Array.isArray(opts.axis) ? opts.axis : [0, 1, 0];
  const al = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const ax = axis[0] / al, ay = axis[1] / al, az = axis[2] / al;
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    let w = _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    // Project ddv along axis to get the "height" — twist scales with height.
    const h = ddx * ax + ddy * ay + ddz * az;
    const ang = s * Math.PI * w * (h / r);
    const c = Math.cos(ang), si = Math.sin(ang);
    const dot = ddx * ax + ddy * ay + ddz * az;
    const cx = ay * ddz - az * ddy;
    const cy = az * ddx - ax * ddz;
    const cz = ax * ddy - ay * ddx;
    const rx = ddx * c + cx * si + ax * dot * (1 - c);
    const ry = ddy * c + cy * si + ay * dot * (1 - c);
    const rz = ddz * c + cz * si + az * dot * (1 - c);
    pos.setXYZ(i, p[0] + rx, p[1] + ry, p[2] + rz);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched };
}

// ── 17. Smooth ────────────────────────────────────────────────────────
// Laplacian smooth — delegates to the slice-621 kind='smooth' brush if
// available so settings panels stay in sync, else uses the local
// polish implementation.
export function smooth(mesh, point, radius = 0.1, strength = 0.5, opts = {}) {
  if (typeof window !== 'undefined'
      && typeof window.__studioSculptBrushApply === 'function'
      && typeof window.__studioSetSculptBrush === 'function'
      && typeof window.__studioGetSculptBrush === 'function') {
    const prev = window.__studioGetSculptBrush();
    try {
      window.__studioSetSculptBrush({ kind: 'smooth', size: radius, strength });
      const r = window.__studioSculptBrushApply(point);
      if (r && r.ok) {
        return { ok: true, touched: r.touched || 0, delegated: true };
      }
    } catch (_) {}
    finally {
      try { window.__studioSetSculptBrush(prev); } catch (_) {}
    }
  }
  return polish(mesh, point, radius, strength, opts);
}

// ── 18. Layer ─────────────────────────────────────────────────────────
// Add a fixed-height bump along the average normal (uniform within
// the radius, with smoothstep falloff at the edge). Distinct from
// "Inflate" — strength here is a height in radius units, not a rate.
export function layer(mesh, point, radius = 0.1, strength = 0.3, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const nrm = _ensureNormal(mesh);
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(-1, Math.min(1, strength));
  // Average normal across the patch.
  const plane = _planeFit(mesh, p, r);
  if (!plane.ok) return { ok: true, touched: 0 };
  const [nx, ny, nz] = plane.normal;
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    let w = _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    const k = s * r * w * 0.4;
    // Mix average normal with per-vertex normal so concave/convex
    // areas still look uniform.
    const mxn = (nx + nrm.getX(i)) * 0.5;
    const myn = (ny + nrm.getY(i)) * 0.5;
    const mzn = (nz + nrm.getZ(i)) * 0.5;
    pos.setXYZ(i, vx + mxn * k, vy + myn * k, vz + mzn * k);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched };
}

// ── 19. DrawSharp ─────────────────────────────────────────────────────
// Pointed-tip displacement: cone falloff (linear in r → 0 at radius),
// pushing along per-vertex normals.
export function drawSharp(mesh, point, radius = 0.08, strength = 0.6, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const nrm = _ensureNormal(mesh);
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(-1, Math.min(1, strength));
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    let w = (1 - d / r); // linear cone (sharper than smoothstep)
    w = w * w; // quadratic — sharper tip
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    const k = s * r * w * 0.6;
    pos.setXYZ(i, vx + nrm.getX(i) * k, vy + nrm.getY(i) * k, vz + nrm.getZ(i) * k);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched };
}

// ── 20. DrawSmooth ────────────────────────────────────────────────────
// Gentle Gaussian falloff push along per-vertex normals.
export function drawSmooth(mesh, point, radius = 0.1, strength = 0.4, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const nrm = _ensureNormal(mesh);
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(-1, Math.min(1, strength));
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    // Gaussian falloff, normalised to 1 at centre.
    const sigma2 = (r * r) * 0.5;
    let w = Math.exp(-(d * d) / sigma2);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    const k = s * r * w * 0.5;
    pos.setXYZ(i, vx + nrm.getX(i) * k, vy + nrm.getY(i) * k, vz + nrm.getZ(i) * k);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched };
}

// ── 21. Bump ──────────────────────────────────────────────────────────
// Single-vertex displacement: find the vertex nearest `point`, push
// it along its normal by `strength * radius`.
export function bump(mesh, point, radius = 0.05, strength = 0.5, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const nrm = _ensureNormal(mesh);
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(-1, Math.min(1, strength));
  let best = -1, bestD = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const ddx = pos.getX(i) - p[0];
    const ddy = pos.getY(i) - p[1];
    const ddz = pos.getZ(i) - p[2];
    const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d2 < bestD) { bestD = d2; best = i; }
  }
  if (best < 0) return { ok: true, touched: 0 };
  const mask = _mask(mesh);
  let w = 1;
  if (mask) w *= (1 - Math.min(1, mask[best]));
  if (opts.alpha) {
    const ddx = pos.getX(best) - p[0];
    const ddz = pos.getZ(best) - p[2];
    const [u, v] = _planarUV(ddx, ddz, r);
    w *= _alphaWeight(opts.alpha, u, v);
  }
  if (w === 0) return { ok: true, touched: 0 };
  const k = s * r * w;
  pos.setXYZ(
    best,
    pos.getX(best) + nrm.getX(best) * k,
    pos.getY(best) + nrm.getY(best) * k,
    pos.getZ(best) + nrm.getZ(best) * k,
  );
  _commit(mesh);
  return { ok: true, touched: 1, vertex: best };
}

// ── 22. Slash ─────────────────────────────────────────────────────────
// Directional cut groove — push verts down (negative normal) along a
// narrow band aligned with stroke direction.
export function slash(mesh, point, radius = 0.1, strength = 0.5, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const nrm = _ensureNormal(mesh);
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(0, Math.min(1, strength));
  const dir = Array.isArray(opts.direction) ? opts.direction : [1, 0, 0];
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const dx = dir[0] / dl, dy = dir[1] / dl, dz = dir[2] / dl;
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    // Perpendicular distance to slash line (cross with dir).
    const cx = ddy * dz - ddz * dy;
    const cy = ddz * dx - ddx * dz;
    const cz = ddx * dy - ddy * dx;
    const perp = Math.hypot(cx, cy, cz);
    const bandWidth = r * 0.25;
    if (perp > bandWidth) continue;
    let w = (1 - perp / bandWidth) * _falloff(1 - d / r);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    const k = -s * r * w * 0.5;
    pos.setXYZ(i, vx + nrm.getX(i) * k, vy + nrm.getY(i) * k, vz + nrm.getZ(i) * k);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched };
}

// ── 23. Brush ─────────────────────────────────────────────────────────
// Generic draw brush with custom alpha texture: push along per-vertex
// normal, with the alpha weight fully driving the cross-section shape.
export function brush(mesh, point, radius = 0.1, strength = 0.4, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const nrm = _ensureNormal(mesh);
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(-1, Math.min(1, strength));
  const alphaName = opts.alpha || 'circle';
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    let w = _falloff(1 - d / r);
    const [u, v] = _planarUV(ddx, ddz, r);
    w *= _alphaWeight(alphaName, u, v);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (w === 0) continue;
    const k = s * r * w * 0.4;
    pos.setXYZ(i, vx + nrm.getX(i) * k, vy + nrm.getY(i) * k, vz + nrm.getZ(i) * k);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched, alpha: alphaName };
}

// ── 24. Mask ──────────────────────────────────────────────────────────
// Paint into the slice-684 sculpt mask — delegates to maskPaint via
// window.__studioSculptMaskPaint if present, else writes the mask
// in-place.
export function mask(mesh, point, radius = 0.05, strength = 1, _opts = {}) {
  if (typeof window !== 'undefined' && typeof window.__studioSculptMaskPaint === 'function') {
    const r = window.__studioSculptMaskPaint(point, radius, strength);
    if (r && r.ok) return { ok: true, touched: r.painted || 0, delegated: true };
  }
  // Fallback: paint locally.
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false };
  mesh.userData = mesh.userData || {};
  const pc = mesh.geometry.attributes.position.count;
  if (!(mesh.userData[MASK_KEY] instanceof Float32Array) || mesh.userData[MASK_KEY].length !== pc) {
    mesh.userData[MASK_KEY] = new Float32Array(pc);
  }
  const m = mesh.userData[MASK_KEY];
  const pos = mesh.geometry.attributes.position;
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.min(1, Math.max(0, strength));
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const ddx = pos.getX(i) - p[0];
    const ddy = pos.getY(i) - p[1];
    const ddz = pos.getZ(i) - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    const w = _falloff(1 - d / r) * s;
    m[i] = Math.min(1, m[i] + w);
    touched++;
  }
  return { ok: true, touched };
}

// ── 25. Wax ───────────────────────────────────────────────────────────
// Additive sticky build-up: each pass adds a small dome that
// accumulates instead of saturating. Models pulled-up wax.
export function wax(mesh, point, radius = 0.1, strength = 0.3, opts = {}) {
  const pos = mesh.geometry.attributes.position;
  const nrm = _ensureNormal(mesh);
  const p = _asPoint(point);
  const r = Math.max(1e-6, radius);
  const s = Math.max(0, Math.min(1, strength));
  const mask = _mask(mesh);
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const ddx = vx - p[0], ddy = vy - p[1], ddz = vz - p[2];
    const d = Math.hypot(ddx, ddy, ddz);
    if (d > r) continue;
    // Dome: cos-shaped (sticky, blends well across overlapping strokes).
    const t = 1 - d / r;
    let w = Math.cos((1 - t) * Math.PI * 0.5);
    if (mask) w *= (1 - Math.min(1, mask[i]));
    if (opts.alpha) {
      const [u, v] = _planarUV(ddx, ddz, r);
      w *= _alphaWeight(opts.alpha, u, v);
    }
    if (w === 0) continue;
    const k = s * r * w * 0.35;
    pos.setXYZ(i, vx + nrm.getX(i) * k, vy + nrm.getY(i) * k, vz + nrm.getZ(i) * k);
    touched++;
  }
  _commit(mesh);
  return { ok: true, touched };
}

// ── Registry ──────────────────────────────────────────────────────────
// Tuple list keeps the iteration order deterministic for the
// installer and the e2e spec.
export const BRUSHES = [
  ['Clay',        clay,        'Flatten + push along plane normal — ZBrush Clay.'],
  ['ClayStrips',  clayStrips,  'Clay with alternating stripe alpha.'],
  ['Crease',      crease,      'Sharp inward fold: pinch + concave displace.'],
  ['Scrape',      scrape,      'Flatten high points down to the stroke plane.'],
  ['Fill',        fill,        'Push low points up to the stroke plane.'],
  ['Pinch',       pinch,       'Pull verts toward the stroke centre.'],
  ['Inflate',     inflate,     'Push along vertex normal (opts.variance jitter).'],
  ['Magnify',     magnify,     'Radial scale outward from stroke centre.'],
  ['Polish',      polish,      'Laplacian smooth limited to brush region.'],
  ['Flatten',     flatten,     'Project verts onto stroke plane.'],
  ['SnakeHook',   snakeHook,   'Drag verts toward a moving target (opts.target).'],
  ['Grab',        grab,        'Translate verts by offset vector (opts.offset).'],
  ['Thumb',       thumb,       'Shear push tangent to surface (opts.direction).'],
  ['Nudge',       nudge,       'Small translation in stroke direction (opts.direction).'],
  ['Rotate',      rotate,      'Rotate verts around stroke point (opts.axis).'],
  ['Twist',       twist,       'Rotate proportionally to height (opts.axis).'],
  ['Smooth',      smooth,      'Laplacian smooth (delegates to slice-621 brush).'],
  ['Layer',       layer,       'Add a fixed-height bump along average normal.'],
  ['DrawSharp',   drawSharp,   'Pointed-tip displacement with cone falloff.'],
  ['DrawSmooth',  drawSmooth,  'Gentle Gaussian falloff push along normals.'],
  ['Bump',        bump,        'Single-vertex displacement at stroke point.'],
  ['Slash',       slash,       'Directional cut groove (opts.direction).'],
  ['Brush',       brush,       'Generic draw with custom alpha texture (opts.alpha).'],
  ['Mask',        mask,        'Paint into the slice-684 sculpt mask.'],
  ['Wax',         wax,         'Additive sticky build-up — cos-shaped dome.'],
];

// Tag THREE so it isn't tree-shaken. (Some brushes import it
// for future expansion; the runtime path only needs vec math.)
export const _THREE_REV = THREE.REVISION;
