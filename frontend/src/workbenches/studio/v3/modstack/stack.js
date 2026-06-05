// ArchDisc Studio V3 — non-destructive modifier stack (core).
//
// Pure data + eval pipeline. No DOM, no React.
//
// Each mesh carries:
//   userData.archdiscStudioBaseGeometry — frozen BufferGeometry snapshot
//                                          captured the first time the
//                                          stack is touched.
//   userData.archdiscStudioModStack    — ORDERED array of
//                                          { uuid, kind, params,
//                                            enabled, viewport }.
//
// Every mutation (add / setEnabled / setParams / reorder / remove /
// clear) calls `rebuildStack(mesh)` which:
//   1. disposes mesh.geometry,
//   2. clones the base back onto mesh.geometry,
//   3. applies each enabled mod in order (top-to-bottom),
//   4. recomputes normals + bounds.
//
// `applyAll(mesh)` bakes the current evaluated geometry as the NEW
// base and empties the stack.
// `resetToBase(mesh)` restores the base, clearing the visible deltas
// but keeping the stack so the user can re-enable mods.
//
// Only depends on three.js + the SimplifyModifier shipped under
// three/examples — no new npm packages, no WASM.

import * as THREE from 'three';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import {
  mergeGeometries,
  mergeVertices,
} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const SUPPORTED_KINDS = Object.freeze([
  'subdivide', 'solidify', 'mirror', 'array', 'decimate',
  'bend', 'twist', 'taper', 'displace', 'smooth',
]);

const _simplify = new SimplifyModifier();

// ─── UUID helper (no crypto deps; ksuid-flavour 16-char base36). ──────────
let _uuidCounter = 0;
function modUuid() {
  _uuidCounter = (_uuidCounter + 1) >>> 0;
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `m-${t}-${_uuidCounter.toString(36)}-${r}`;
}

// ─── Base-geometry snapshot. ──────────────────────────────────────────────
// We deep-clone the user's geometry the FIRST time the stack is touched
// and stash the clone on userData. Every rebuild starts from that clone.
//
// applyAll() promotes the currently-evaluated geometry to a new base.
export function ensureBaseGeometry(mesh) {
  if (!mesh || !mesh.geometry) return null;
  if (!mesh.userData) mesh.userData = {};
  if (!mesh.userData.archdiscStudioBaseGeometry) {
    mesh.userData.archdiscStudioBaseGeometry = mesh.geometry.clone();
  }
  return mesh.userData.archdiscStudioBaseGeometry;
}

export function ensureStack(mesh) {
  if (!mesh) return null;
  if (!mesh.userData) mesh.userData = {};
  const cur = mesh.userData.archdiscStudioModStack;
  if (!Array.isArray(cur)) {
    // Slice 636's recipe-only stack used an object schema
    // `{ base, mods }`. We replace it with the real array stack the
    // first time the new pipeline touches the mesh.
    mesh.userData.archdiscStudioModStack = [];
  }
  return mesh.userData.archdiscStudioModStack;
}

// ─── Modifier implementations. ────────────────────────────────────────────
// Every modifier returns a *new* BufferGeometry; the pipeline disposes
// the previous one. Modifiers MUST be pure w.r.t. their inputs.

function _toIndexed(geometry) {
  // Most modifiers (mirror / array / decimate) need an indexed geometry
  // with merged duplicate vertices. Cheaply normalize at entry.
  let g = geometry;
  if (!g.index) g = mergeVertices(g, 1e-4);
  return g;
}

function _toNonIndexed(geometry) {
  if (!geometry.index) return geometry;
  return geometry.toNonIndexed();
}

// SUBDIVIDE — Catmull-style midpoint subdivision (1-iteration loop split).
// For each triangle, insert a midpoint per edge → 4 sub-triangles.
function modSubdivide(geometry, params) {
  const iters = Math.max(1, Math.min(4, (params && params.iterations) | 0 || 1));
  let g = _toIndexed(geometry);
  for (let it = 0; it < iters; it++) {
    const pos = g.attributes.position;
    const idx = g.index.array;
    const verts = [];
    for (let i = 0; i < pos.count; i++) {
      verts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    const midCache = new Map();
    const triCount = idx.length / 3;
    const newIdx = [];
    const midpoint = (a, b) => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      let id = midCache.get(k);
      if (id !== undefined) return id;
      const ax = verts[a * 3 + 0], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
      const bx = verts[b * 3 + 0], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
      id = verts.length / 3;
      verts.push((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
      midCache.set(k, id);
      return id;
    };
    for (let f = 0; f < triCount; f++) {
      const a = idx[f * 3 + 0], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      newIdx.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    ng.setIndex(newIdx);
    g = ng;
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// SOLIDIFY — extrude the surface outward by `thickness` along vertex
// normals, then stitch the two shells with side quads (open meshes get
// proper rim faces). Result is closed-ish so it shades correctly.
function modSolidify(geometry, params) {
  const thickness = (params && Number.isFinite(params.thickness)) ? +params.thickness : 0.05;
  const g = _toIndexed(geometry);
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const idx = g.index.array;
  const vCount = pos.count;
  const verts = new Array(vCount * 2 * 3);
  for (let i = 0; i < vCount; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    verts[i * 3 + 0] = x;
    verts[i * 3 + 1] = y;
    verts[i * 3 + 2] = z;
    const o = (vCount + i) * 3;
    verts[o + 0] = x + nx * thickness;
    verts[o + 1] = y + ny * thickness;
    verts[o + 2] = z + nz * thickness;
  }
  const newIdx = [];
  // outer shell (original)
  for (let f = 0; f < idx.length; f += 3) {
    newIdx.push(idx[f], idx[f + 1], idx[f + 2]);
  }
  // inner shell (offset) — flipped winding so its normals face inward
  for (let f = 0; f < idx.length; f += 3) {
    newIdx.push(
      vCount + idx[f + 2],
      vCount + idx[f + 1],
      vCount + idx[f + 0],
    );
  }
  // Rim — edges that appear in exactly one triangle bridge the two shells.
  const edgeCount = new Map();
  const pushEdge = (a, b) => {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`;
    const e = edgeCount.get(k);
    if (e) { e.c += 1; }
    else edgeCount.set(k, { a, b, c: 1 });
  };
  for (let f = 0; f < idx.length; f += 3) {
    pushEdge(idx[f], idx[f + 1]);
    pushEdge(idx[f + 1], idx[f + 2]);
    pushEdge(idx[f + 2], idx[f]);
  }
  for (const { a, b, c } of edgeCount.values()) {
    if (c !== 1) continue;
    const a2 = vCount + a, b2 = vCount + b;
    newIdx.push(a, b, b2);
    newIdx.push(a, b2, a2);
  }
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  ng.setIndex(newIdx);
  ng.computeVertexNormals();
  ng.computeBoundingSphere();
  ng.computeBoundingBox();
  return ng;
}

// MIRROR — duplicate geometry across an axis plane through origin and
// (optionally) weld the two halves where they meet.
function modMirror(geometry, params) {
  const axis = (params && params.axis) || 'x';
  const merge = !!(params && params.merge);
  const g = _toIndexed(geometry);
  const pos = g.attributes.position;
  const idx = g.index.array;
  const verts = [];
  for (let i = 0; i < pos.count; i++) {
    verts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  const offset = pos.count;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (axis === 'x') verts.push(-x, y, z);
    else if (axis === 'y') verts.push(x, -y, z);
    else verts.push(x, y, -z);
  }
  const out = [];
  for (let i = 0; i < idx.length; i += 3) out.push(idx[i], idx[i + 1], idx[i + 2]);
  for (let i = 0; i < idx.length; i += 3) {
    out.push(idx[i + 2] + offset, idx[i + 1] + offset, idx[i] + offset);
  }
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  ng.setIndex(out);
  let result = ng;
  if (merge) result = mergeVertices(ng, 1e-4);
  result.computeVertexNormals();
  result.computeBoundingSphere();
  result.computeBoundingBox();
  return result;
}

// ARRAY — N translated copies along a direction. Each copy is welded
// into a single buffer geometry.
function modArray(geometry, params) {
  const count = Math.max(1, Math.min(64, (params && params.count) | 0 || 3));
  const ox = (params && Number.isFinite(params.offsetX)) ? +params.offsetX : 1;
  const oy = (params && Number.isFinite(params.offsetY)) ? +params.offsetY : 0;
  const oz = (params && Number.isFinite(params.offsetZ)) ? +params.offsetZ : 0;
  const geos = [];
  for (let i = 0; i < count; i++) {
    const g = geometry.clone();
    g.translate(ox * i, oy * i, oz * i);
    // Strip everything but position + normal so merge succeeds even
    // when modifiers earlier in the stack diverged on attributes.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false) || geos[0].clone();
  for (const g of geos) g.dispose();
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

// DECIMATE — call SimplifyModifier to remove a fraction of verts. Ratio
// 0..1, defaulting to 0.5 (50 % vertex reduction).
function modDecimate(geometry, params) {
  const ratio = Math.max(0, Math.min(0.95,
    (params && Number.isFinite(params.ratio)) ? +params.ratio : 0.5));
  const g = _toIndexed(geometry);
  if (!g.attributes.position || g.attributes.position.count < 6) {
    // Too small to simplify safely — return a clean clone.
    const clone = g.clone();
    clone.computeVertexNormals();
    clone.computeBoundingSphere();
    return clone;
  }
  const total = g.attributes.position.count;
  const removeCount = Math.max(0, Math.min(total - 4, Math.floor(total * ratio)));
  let out;
  try {
    out = _simplify.modify(g, removeCount);
  } catch (_) {
    out = g.clone();
  }
  out.computeVertexNormals();
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// BEND — bend along an axis ('x'|'y'|'z') by `angle` radians, hinged
// at the midpoint of the geometry's bounding box along that axis.
function modBend(geometry, params) {
  const axis = (params && params.axis) || 'y';
  const angle = (params && Number.isFinite(params.angle)) ? +params.angle : Math.PI / 6;
  const g = geometry.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox;
  if (!bb) return g;
  const minA = bb.min[axis], maxA = bb.max[axis];
  const span = Math.max(1e-6, maxA - minA);
  const pos = g.attributes.position;
  const arr = pos.array;
  for (let i = 0; i < pos.count; i++) {
    const o = i * 3;
    const px = arr[o], py = arr[o + 1], pz = arr[o + 2];
    let a = 0, x, y;
    if (axis === 'y') {
      a = ((py - minA) / span - 0.5) * angle;
      x = px * Math.cos(a) - pz * Math.sin(a);
      y = px * Math.sin(a) + pz * Math.cos(a);
      arr[o] = x; arr[o + 1] = py; arr[o + 2] = y;
    } else if (axis === 'x') {
      a = ((px - minA) / span - 0.5) * angle;
      x = py * Math.cos(a) - pz * Math.sin(a);
      y = py * Math.sin(a) + pz * Math.cos(a);
      arr[o] = px; arr[o + 1] = x; arr[o + 2] = y;
    } else {
      a = ((pz - minA) / span - 0.5) * angle;
      x = px * Math.cos(a) - py * Math.sin(a);
      y = px * Math.sin(a) + py * Math.cos(a);
      arr[o] = x; arr[o + 1] = y; arr[o + 2] = pz;
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// TWIST — rotate vertices around an axis by an angle scaled by the
// vertex's position along that axis (so the ends twist relative to
// the middle).
function modTwist(geometry, params) {
  const axis = (params && params.axis) || 'y';
  const angle = (params && Number.isFinite(params.angle)) ? +params.angle : Math.PI;
  const g = geometry.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox;
  if (!bb) return g;
  const minA = bb.min[axis], maxA = bb.max[axis];
  const span = Math.max(1e-6, maxA - minA);
  const pos = g.attributes.position;
  const arr = pos.array;
  for (let i = 0; i < pos.count; i++) {
    const o = i * 3;
    const px = arr[o], py = arr[o + 1], pz = arr[o + 2];
    const v = axis === 'x' ? px : axis === 'y' ? py : pz;
    const t = (v - minA) / span;
    const a = (t - 0.5) * angle;
    const c = Math.cos(a), s = Math.sin(a);
    if (axis === 'y') {
      arr[o] = px * c - pz * s;
      arr[o + 1] = py;
      arr[o + 2] = px * s + pz * c;
    } else if (axis === 'x') {
      arr[o] = px;
      arr[o + 1] = py * c - pz * s;
      arr[o + 2] = py * s + pz * c;
    } else {
      arr[o] = px * c - py * s;
      arr[o + 1] = px * s + py * c;
      arr[o + 2] = pz;
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// TAPER — scale verts on the cross-section perpendicular to an axis
// by a factor that ramps from `topScale` at +axis to `bottomScale`
// at -axis. Pinches/swells along the chosen axis.
function modTaper(geometry, params) {
  const axis = (params && params.axis) || 'y';
  const topS = (params && Number.isFinite(params.topScale)) ? +params.topScale : 0.2;
  const botS = (params && Number.isFinite(params.bottomScale)) ? +params.bottomScale : 1.0;
  const g = geometry.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox;
  if (!bb) return g;
  const minA = bb.min[axis], maxA = bb.max[axis];
  const span = Math.max(1e-6, maxA - minA);
  const pos = g.attributes.position;
  const arr = pos.array;
  for (let i = 0; i < pos.count; i++) {
    const o = i * 3;
    const v = axis === 'x' ? arr[o] : axis === 'y' ? arr[o + 1] : arr[o + 2];
    const t = (v - minA) / span;
    const s = botS + (topS - botS) * t;
    if (axis === 'y') { arr[o] *= s; arr[o + 2] *= s; }
    else if (axis === 'x') { arr[o + 1] *= s; arr[o + 2] *= s; }
    else { arr[o] *= s; arr[o + 1] *= s; }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// DISPLACE — push verts along their normals by procedural fractal-like
// noise (deterministic hash, no external dep). Sum two octaves for a
// somewhat organic look.
function _hashNoise(x, y, z, seed) {
  // Deterministic 3D value-noise hash → -1..1.
  const s = seed | 0;
  let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)
         ^ Math.imul(z | 0, 2147483647) ^ Math.imul(s, 1274126177)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return ((h & 0xffff) / 0x7fff) - 1;
}
function _smoothNoise(x, y, z, seed) {
  // Trilinearly-interpolated value noise from the lattice hash.
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const c000 = _hashNoise(xi, yi, zi, seed);
  const c100 = _hashNoise(xi + 1, yi, zi, seed);
  const c010 = _hashNoise(xi, yi + 1, zi, seed);
  const c110 = _hashNoise(xi + 1, yi + 1, zi, seed);
  const c001 = _hashNoise(xi, yi, zi + 1, seed);
  const c101 = _hashNoise(xi + 1, yi, zi + 1, seed);
  const c011 = _hashNoise(xi, yi + 1, zi + 1, seed);
  const c111 = _hashNoise(xi + 1, yi + 1, zi + 1, seed);
  const x00 = c000 * (1 - u) + c100 * u;
  const x10 = c010 * (1 - u) + c110 * u;
  const x01 = c001 * (1 - u) + c101 * u;
  const x11 = c011 * (1 - u) + c111 * u;
  const y0 = x00 * (1 - v) + x10 * v;
  const y1 = x01 * (1 - v) + x11 * v;
  return y0 * (1 - w) + y1 * w;
}
function modDisplace(geometry, params) {
  const strength = (params && Number.isFinite(params.strength)) ? +params.strength : 0.1;
  const scale = (params && Number.isFinite(params.scale)) ? +params.scale : 4;
  const seed = (params && Number.isFinite(params.seed)) ? params.seed | 0 : 1234;
  const g = geometry.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const pa = pos.array;
  for (let i = 0; i < pos.count; i++) {
    const o = i * 3;
    const x = pa[o], y = pa[o + 1], z = pa[o + 2];
    const n1 = _smoothNoise(x * scale, y * scale, z * scale, seed);
    const n2 = _smoothNoise(x * scale * 2.13, y * scale * 2.13, z * scale * 2.13, seed + 1) * 0.5;
    const w = (n1 + n2) * strength;
    pa[o + 0] = x + nor.getX(i) * w;
    pa[o + 1] = y + nor.getY(i) * w;
    pa[o + 2] = z + nor.getZ(i) * w;
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// SMOOTH — Laplacian smoothing. Each vertex moves toward the average
// of its 1-ring neighbours by `factor`. Iterations stack the effect.
function modSmooth(geometry, params) {
  const iters = Math.max(1, Math.min(20, (params && params.iterations) | 0 || 1));
  const factor = Math.max(0, Math.min(1,
    (params && Number.isFinite(params.factor)) ? +params.factor : 0.5));
  const g = _toIndexed(geometry);
  const pos = g.attributes.position;
  const idx = g.index.array;
  const n = pos.count;
  // Build neighbour adjacency.
  const adj = new Array(n);
  for (let i = 0; i < n; i++) adj[i] = new Set();
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f], b = idx[f + 1], c = idx[f + 2];
    adj[a].add(b); adj[a].add(c);
    adj[b].add(a); adj[b].add(c);
    adj[c].add(a); adj[c].add(b);
  }
  const cur = new Float32Array(pos.array);
  const next = new Float32Array(cur.length);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const nbrs = adj[i];
      if (nbrs.size === 0) {
        next[o] = cur[o]; next[o + 1] = cur[o + 1]; next[o + 2] = cur[o + 2];
        continue;
      }
      let sx = 0, sy = 0, sz = 0;
      for (const j of nbrs) {
        const oj = j * 3;
        sx += cur[oj]; sy += cur[oj + 1]; sz += cur[oj + 2];
      }
      const inv = 1 / nbrs.size;
      const ax = sx * inv, ay = sy * inv, az = sz * inv;
      next[o] = cur[o] + (ax - cur[o]) * factor;
      next[o + 1] = cur[o + 1] + (ay - cur[o + 1]) * factor;
      next[o + 2] = cur[o + 2] + (az - cur[o + 2]) * factor;
    }
    // Swap.
    for (let k = 0; k < cur.length; k++) cur[k] = next[k];
  }
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.Float32BufferAttribute(cur, 3));
  ng.setIndex(Array.from(idx));
  ng.computeVertexNormals();
  ng.computeBoundingSphere();
  ng.computeBoundingBox();
  return ng;
}

const KIND_FNS = {
  subdivide: modSubdivide,
  solidify:  modSolidify,
  mirror:    modMirror,
  array:     modArray,
  decimate:  modDecimate,
  bend:      modBend,
  twist:     modTwist,
  taper:     modTaper,
  displace:  modDisplace,
  smooth:    modSmooth,
};

export function applyOne(geometry, kind, params) {
  const fn = KIND_FNS[kind];
  if (!fn) return geometry.clone();
  return fn(geometry, params || {});
}

// ─── Eval pipeline. ───────────────────────────────────────────────────────
export function rebuildStack(mesh) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  const base = ensureBaseGeometry(mesh);
  if (!base) return { ok: false, error: 'no base geometry' };
  const stack = ensureStack(mesh);
  let cur = base.clone();
  let lastGood = null;
  let evaluated = 0;
  for (const mod of stack) {
    if (!mod.enabled) continue;
    // viewport === false lets the user suppress preview while keeping
    // the modifier in the stack for export-time application.
    if (mod.viewport === false) continue;
    try {
      lastGood = cur;
      cur = applyOne(cur, mod.kind, mod.params);
      if (lastGood !== base) lastGood.dispose();
      evaluated += 1;
    } catch (err) {
      // Bad params → keep the previous-step geometry, skip this mod.
      cur = lastGood;
      // eslint-disable-next-line no-console
      try { console.warn('modstack: skipping', mod.kind, err && err.message); } catch (_) {}
    }
  }
  cur.computeVertexNormals();
  cur.computeBoundingSphere();
  cur.computeBoundingBox();
  if (mesh.geometry && mesh.geometry !== cur) {
    try { mesh.geometry.dispose(); } catch (_) {}
  }
  mesh.geometry = cur;
  return { ok: true, evaluated, total: stack.length };
}

// ─── CRUD. ────────────────────────────────────────────────────────────────
export function addMod(mesh, kind, params) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  if (!KIND_FNS[kind]) return { ok: false, error: `unsupported kind: ${kind}` };
  ensureBaseGeometry(mesh);
  const stack = ensureStack(mesh);
  const mod = {
    uuid: modUuid(),
    kind,
    params: params ? { ...params } : {},
    enabled: true,
    viewport: true,
  };
  stack.push(mod);
  const r = rebuildStack(mesh);
  return { ok: true, uuid: mod.uuid, count: stack.length, evaluated: r.evaluated };
}

export function listMods(mesh) {
  if (!mesh) return { count: 0, mods: [] };
  const stack = ensureStack(mesh);
  return {
    count: stack.length,
    mods: stack.map((m) => ({
      uuid: m.uuid,
      kind: m.kind,
      params: { ...(m.params || {}) },
      enabled: m.enabled !== false,
      viewport: m.viewport !== false,
    })),
  };
}

export function setEnabled(mesh, uuid, on) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  const stack = ensureStack(mesh);
  const mod = stack.find((m) => m.uuid === uuid);
  if (!mod) return { ok: false, error: 'no mod' };
  mod.enabled = !!on;
  const r = rebuildStack(mesh);
  return { ok: true, enabled: mod.enabled, evaluated: r.evaluated };
}

export function setViewport(mesh, uuid, on) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  const stack = ensureStack(mesh);
  const mod = stack.find((m) => m.uuid === uuid);
  if (!mod) return { ok: false, error: 'no mod' };
  mod.viewport = !!on;
  const r = rebuildStack(mesh);
  return { ok: true, viewport: mod.viewport, evaluated: r.evaluated };
}

export function setParams(mesh, uuid, params) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  const stack = ensureStack(mesh);
  const mod = stack.find((m) => m.uuid === uuid);
  if (!mod) return { ok: false, error: 'no mod' };
  mod.params = params ? { ...params } : {};
  const r = rebuildStack(mesh);
  return { ok: true, params: { ...mod.params }, evaluated: r.evaluated };
}

export function reorder(mesh, uuid, newIndex) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  const stack = ensureStack(mesh);
  const idx = stack.findIndex((m) => m.uuid === uuid);
  if (idx < 0) return { ok: false, error: 'no mod' };
  const ni = Math.max(0, Math.min(stack.length - 1, newIndex | 0));
  const [moved] = stack.splice(idx, 1);
  stack.splice(ni, 0, moved);
  const r = rebuildStack(mesh);
  return { ok: true, from: idx, to: ni, evaluated: r.evaluated };
}

export function removeMod(mesh, uuid) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  const stack = ensureStack(mesh);
  const idx = stack.findIndex((m) => m.uuid === uuid);
  if (idx < 0) return { ok: false, error: 'no mod' };
  stack.splice(idx, 1);
  const r = rebuildStack(mesh);
  return { ok: true, removed: uuid, count: stack.length, evaluated: r.evaluated };
}

export function clearAll(mesh) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  const stack = ensureStack(mesh);
  const had = stack.length;
  stack.length = 0;
  const r = rebuildStack(mesh);
  return { ok: true, cleared: had, evaluated: r.evaluated };
}

// applyAll — bake the current evaluated geometry as the new base and
// clear the stack. After this, the mesh has no modifiers but the
// "applied" delta is permanent.
export function applyAll(mesh) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  const stack = ensureStack(mesh);
  const had = stack.length;
  // Force a rebuild first so mesh.geometry reflects the live stack.
  rebuildStack(mesh);
  // Promote the evaluated geometry to the new base; dispose the old.
  const oldBase = mesh.userData.archdiscStudioBaseGeometry;
  mesh.userData.archdiscStudioBaseGeometry = mesh.geometry.clone();
  if (oldBase) try { oldBase.dispose(); } catch (_) {}
  stack.length = 0;
  return { ok: true, baked: had };
}

// resetToBase — restore mesh.geometry to the base snapshot. Keeps the
// stack so the user can re-enable mods after seeing the original.
export function resetToBase(mesh) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  const base = ensureBaseGeometry(mesh);
  if (!base) return { ok: false, error: 'no base' };
  if (mesh.geometry && mesh.geometry !== base) {
    try { mesh.geometry.dispose(); } catch (_) {}
  }
  mesh.geometry = base.clone();
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
  mesh.geometry.computeBoundingBox();
  return { ok: true };
}
