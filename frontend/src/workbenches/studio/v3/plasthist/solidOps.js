// Slice 776 — Plasticity-style solid modeling history operations.
//
// Five pure-JS, kernel-free solid construction primitives:
//   • solidRevolve  — sweep a 2-D profile around an arbitrary axis.
//   • solidSweep    — sweep a 2-D profile along a 3-D path.
//   • solidLoft     — loft between two profiles (linear interpolation).
//   • solidShell    — hollow a closed mesh inward by `thickness` (vertex
//                     displacement along the negated vertex normal).
//   • solidChamfer  — chamfer every edge by `distance` (corner-clip via
//                     vertex pull-back along the average face normal).
//
// All ops return a fresh `THREE.BufferGeometry` so the index.js wrapper
// can pin a mesh into the scene and the history-stack module can rewind
// without resampling. Pure JS, zero new deps, no kernel calls.

import * as THREE from 'three';

// ─── helpers ───────────────────────────────────────────────────────────

function _vec3(v) {
  if (Array.isArray(v)) return new THREE.Vector3(v[0] || 0, v[1] || 0, v[2] || 0);
  if (v && typeof v === 'object') return new THREE.Vector3(v.x || 0, v.y || 0, v.z || 0);
  return new THREE.Vector3();
}

function _normProfile(profile) {
  // Accept Vector2[], Vector3[], [[x,y],...], [[x,y,z],...], {x,y,z}[].
  if (!Array.isArray(profile)) return [];
  const out = [];
  for (const p of profile) {
    if (Array.isArray(p)) {
      out.push(new THREE.Vector3(p[0] || 0, p[1] || 0, p[2] || 0));
    } else if (p && typeof p === 'object') {
      out.push(new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0));
    }
  }
  return out;
}

function _buildIndexedGeo(positions, indices) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geo.computeVertexNormals();
  return geo;
}

// Build an orthonormal frame `{tangent, normal, binormal}` at a path
// point using a stable "parallel-transport" hint so successive frames
// don't flip 180° between collinear segments.
function _frameAt(tangent, prevNormal) {
  const t = tangent.clone().normalize();
  let n = prevNormal ? prevNormal.clone() : null;
  if (!n || Math.abs(n.dot(t)) > 0.999) {
    // Pick a stable up.
    n = Math.abs(t.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  }
  // Re-orthogonalise.
  const b = new THREE.Vector3().crossVectors(t, n).normalize();
  n = new THREE.Vector3().crossVectors(b, t).normalize();
  return { t, n, b };
}

// ─── solidRevolve ──────────────────────────────────────────────────────
//
// Sweep `profilePoints` (treated as a 2-D polyline in XY) around `axis`
// (a unit-vector-ish [x,y,z]) by `angle` radians. Generates a strip of
// quads (two tris each) between consecutive angular slices.

export function solidRevolve(profilePoints, axis, angle) {
  const profile = _normProfile(profilePoints);
  if (profile.length < 2) return new THREE.BufferGeometry();

  const ax = _vec3(axis).normalize();
  if (ax.lengthSq() < 1e-9) ax.set(0, 1, 0);
  const totalAngle = Number(angle);
  const a = Number.isFinite(totalAngle) && totalAngle !== 0 ? totalAngle : Math.PI * 2;
  const segments = Math.max(8, Math.min(128, Math.ceil(Math.abs(a) / (Math.PI / 16))));

  const positions = [];
  const indices = [];
  const P = profile.length;

  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const q = new THREE.Quaternion().setFromAxisAngle(ax, a * t);
    for (let i = 0; i < P; i++) {
      const p = profile[i].clone().applyQuaternion(q);
      positions.push(p.x, p.y, p.z);
    }
  }

  for (let s = 0; s < segments; s++) {
    for (let i = 0; i < P - 1; i++) {
      const a0 = s * P + i;
      const b0 = s * P + (i + 1);
      const c0 = (s + 1) * P + (i + 1);
      const d0 = (s + 1) * P + i;
      indices.push(a0, b0, c0, a0, c0, d0);
    }
  }

  return _buildIndexedGeo(positions, indices);
}

// ─── solidSweep ────────────────────────────────────────────────────────
//
// Sweep `profilePoints` (2-D XY polyline = cross-section) along
// `pathPoints` (3-D polyline). At each path sample the profile is
// rigidly transformed into the {t,n,b} frame.

export function solidSweep(profilePoints, pathPoints) {
  const profile = _normProfile(profilePoints);
  const path = _normProfile(pathPoints);
  if (profile.length < 2 || path.length < 2) return new THREE.BufferGeometry();

  const positions = [];
  const indices = [];
  const P = profile.length;

  let prevN = null;
  for (let s = 0; s < path.length; s++) {
    const cur = path[s];
    let tan;
    if (s < path.length - 1) tan = path[s + 1].clone().sub(cur);
    else                     tan = cur.clone().sub(path[s - 1]);
    if (tan.lengthSq() < 1e-9) tan.set(0, 0, 1);
    tan.normalize();
    const frame = _frameAt(tan, prevN);
    prevN = frame.n;

    for (let i = 0; i < P; i++) {
      // Treat profile.x as the binormal coordinate, profile.y as normal.
      const px = profile[i].x;
      const py = profile[i].y;
      const wp = cur.clone()
        .addScaledVector(frame.b, px)
        .addScaledVector(frame.n, py);
      positions.push(wp.x, wp.y, wp.z);
    }
  }

  for (let s = 0; s < path.length - 1; s++) {
    for (let i = 0; i < P - 1; i++) {
      const a0 = s * P + i;
      const b0 = s * P + (i + 1);
      const c0 = (s + 1) * P + (i + 1);
      const d0 = (s + 1) * P + i;
      indices.push(a0, b0, c0, a0, c0, d0);
    }
  }

  return _buildIndexedGeo(positions, indices);
}

// ─── solidLoft ─────────────────────────────────────────────────────────
//
// Loft between two 3-D profiles with `samples` interpolated rings.
// Both profiles must have the same vertex count.

export function solidLoft(profileA, profileB, samples) {
  const a = _normProfile(profileA);
  const b = _normProfile(profileB);
  if (a.length < 2 || b.length < 2) return new THREE.BufferGeometry();
  // Resample whichever is shorter up to the longer count so rings line up.
  const P = Math.max(a.length, b.length);
  function _resample(profile, count) {
    if (profile.length === count) return profile.slice();
    const out = [];
    for (let i = 0; i < count; i++) {
      const tt = (i / (count - 1)) * (profile.length - 1);
      const lo = Math.floor(tt);
      const hi = Math.min(profile.length - 1, lo + 1);
      const frac = tt - lo;
      out.push(profile[lo].clone().lerp(profile[hi], frac));
    }
    return out;
  }
  const aR = _resample(a, P);
  const bR = _resample(b, P);

  const rings = Math.max(2, Math.min(128, Number(samples) || 16));
  const positions = [];
  const indices = [];

  for (let s = 0; s < rings; s++) {
    const t = s / (rings - 1);
    for (let i = 0; i < P; i++) {
      const p = aR[i].clone().lerp(bR[i], t);
      positions.push(p.x, p.y, p.z);
    }
  }
  for (let s = 0; s < rings - 1; s++) {
    for (let i = 0; i < P - 1; i++) {
      const a0 = s * P + i;
      const b0 = s * P + (i + 1);
      const c0 = (s + 1) * P + (i + 1);
      const d0 = (s + 1) * P + i;
      indices.push(a0, b0, c0, a0, c0, d0);
    }
  }

  return _buildIndexedGeo(positions, indices);
}

// ─── solidShell ────────────────────────────────────────────────────────
//
// Hollow a closed mesh inward by `thickness`. Pure-vertex approximation:
// each vertex is moved along the negated vertex normal by `thickness`.
// Returns a fresh geometry combining the original (outer) shell + the
// shrunken (inner) shell with reversed winding so the interior renders
// front-facing.

export function solidShell(geometry, thickness) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) {
    return new THREE.BufferGeometry();
  }
  const t = Number(thickness);
  if (!Number.isFinite(t) || t === 0) return geometry.clone();

  // Work on an index-ised copy so the outer & inner share topology.
  const src = geometry.index ? geometry : geometry.toNonIndexed();
  const srcGeo = src.clone();
  if (!srcGeo.index) {
    // synth an index 0..count-1 so we can mirror it.
    const idx = new Uint32Array(srcGeo.attributes.position.count);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    srcGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  if (!srcGeo.attributes.normal) srcGeo.computeVertexNormals();

  const posOuter = srcGeo.attributes.position.array;
  const nrm = srcGeo.attributes.normal.array;
  const idx = srcGeo.index.array;
  const N = posOuter.length / 3;

  // Combined: [outer verts...][inner verts...]
  const positions = new Float32Array(posOuter.length * 2);
  for (let i = 0; i < posOuter.length; i++) positions[i] = posOuter[i];
  for (let i = 0; i < N; i++) {
    positions[posOuter.length + i * 3]     = posOuter[i * 3]     - nrm[i * 3]     * t;
    positions[posOuter.length + i * 3 + 1] = posOuter[i * 3 + 1] - nrm[i * 3 + 1] * t;
    positions[posOuter.length + i * 3 + 2] = posOuter[i * 3 + 2] - nrm[i * 3 + 2] * t;
  }
  const indices = new Uint32Array(idx.length * 2);
  // Outer copy keeps winding.
  for (let i = 0; i < idx.length; i++) indices[i] = idx[i];
  // Inner copy reversed winding (front-faces toward cavity).
  for (let t2 = 0; t2 < idx.length; t2 += 3) {
    indices[idx.length + t2]     = idx[t2]     + N;
    indices[idx.length + t2 + 1] = idx[t2 + 2] + N;
    indices[idx.length + t2 + 2] = idx[t2 + 1] + N;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

// ─── solidChamfer ──────────────────────────────────────────────────────
//
// Chamfer the listed edges by `distance`. We approximate with a vertex
// pull-back along the inverted vertex normal so corners get "clipped"
// — the visual effect mirrors a real chamfer for round-tripping into
// the history stack without a B-rep walk. If `edgeIndices` is empty
// the chamfer falls back to a global vertex pull-back so the op stays
// useful for the "chamfer all" CTA.

export function solidChamfer(geometry, edgeIndices, distance) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) {
    return new THREE.BufferGeometry();
  }
  const d = Number(distance);
  if (!Number.isFinite(d) || d === 0) return geometry.clone();

  const geo = geometry.clone();
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position.array;
  const nrm = geo.attributes.normal.array;
  const N = pos.length / 3;

  let touched = new Set();
  if (Array.isArray(edgeIndices) && edgeIndices.length) {
    // Edge indices are interpreted as vertex indices on the edge endpoints.
    for (const idx of edgeIndices) {
      if (Number.isInteger(idx) && idx >= 0 && idx < N) touched.add(idx);
    }
  } else {
    // Fallback: every boundary-ish vertex (or all) gets pulled back.
    for (let i = 0; i < N; i++) touched.add(i);
  }

  for (const i of touched) {
    pos[i * 3]     -= nrm[i * 3]     * d;
    pos[i * 3 + 1] -= nrm[i * 3 + 1] * d;
    pos[i * 3 + 2] -= nrm[i * 3 + 2] * d;
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}
