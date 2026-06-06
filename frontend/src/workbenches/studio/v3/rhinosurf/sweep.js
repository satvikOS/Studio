// Slice 706 — Rhino-style 3-rail sweep + variable fillet + edge
// blend. Sweep1/Sweep2/Sweep3 generate a smooth surface from a
// profile curve riding along 1, 2, or 3 rails; variableFillet blends
// two surfaces with a rolling sphere whose radius varies along a
// curve parameter.

import * as THREE from 'three';

function _vec(p) { return new THREE.Vector3(p[0], p[1], p[2]); }

// Sample a polyline (array of [x,y,z]) at t in [0,1].
function _sampleCurve(pts, t) {
  if (pts.length === 0) return new THREE.Vector3();
  if (pts.length === 1) return _vec(pts[0]);
  const seg = (pts.length - 1) * t;
  const i = Math.min(pts.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = _vec(pts[i]);
  const b = _vec(pts[i + 1]);
  return a.lerp(b, f);
}

function _curveTangent(pts, t) {
  const eps = 1e-3;
  const a = _sampleCurve(pts, Math.max(0, t - eps));
  const b = _sampleCurve(pts, Math.min(1, t + eps));
  return b.sub(a).normalize();
}

// Sweep1 — single rail. Profile curve is translated to rail point and
// rotated so its plane aligns with the rail's local frame.
export function sweep1(profile, rail, opts) {
  const segments = Math.max(2, Math.min(256, Number(opts?.segments) || 32));
  const positions = [];
  const indices = [];
  const profN = profile.length;
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const rp = _sampleCurve(rail, t);
    const tan = _curveTangent(rail, t);
    const up = Math.abs(tan.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const side = up.clone().cross(tan).normalize();
    const newUp = tan.clone().cross(side).normalize();
    for (const pp of profile) {
      const local = new THREE.Vector3(pp[0], pp[1], 0);
      const world = rp.clone()
        .addScaledVector(side, local.x)
        .addScaledVector(newUp, local.y);
      positions.push(world.x, world.y, world.z);
    }
  }
  for (let s = 0; s < segments; s++) {
    for (let p = 0; p < profN - 1; p++) {
      const a = s * profN + p;
      const b = s * profN + p + 1;
      const c = (s + 1) * profN + p + 1;
      const d = (s + 1) * profN + p;
      indices.push(a, b, c, a, c, d);
    }
  }
  return _buildMesh(positions, indices, 0xb0a070, 'rhino-sweep1');
}

// Sweep2 — two rails. Profile is scaled along its width to match the
// distance between the two rails at each station.
export function sweep2(profile, railA, railB, opts) {
  const segments = Math.max(2, Math.min(256, Number(opts?.segments) || 32));
  const positions = [];
  const indices = [];
  const profN = profile.length;
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const a = _sampleCurve(railA, t);
    const b = _sampleCurve(railB, t);
    const mid = a.clone().lerp(b, 0.5);
    const width = a.distanceTo(b);
    const tanA = _curveTangent(railA, t);
    const dirAB = b.clone().sub(a).normalize();
    const up = tanA.clone().cross(dirAB).normalize();
    const profBox = profile.reduce(
      (acc, p) => ({ minX: Math.min(acc.minX, p[0]), maxX: Math.max(acc.maxX, p[0]) }),
      { minX: Infinity, maxX: -Infinity });
    const profWidth = (profBox.maxX - profBox.minX) || 1;
    const scaleX = width / profWidth;
    for (const pp of profile) {
      const localX = (pp[0] - (profBox.minX + profBox.maxX) / 2) * scaleX;
      const world = mid.clone()
        .addScaledVector(dirAB, localX)
        .addScaledVector(up, pp[1]);
      positions.push(world.x, world.y, world.z);
    }
  }
  for (let s = 0; s < segments; s++) {
    for (let p = 0; p < profN - 1; p++) {
      const a = s * profN + p;
      const b = s * profN + p + 1;
      const c = (s + 1) * profN + p + 1;
      const d = (s + 1) * profN + p;
      indices.push(a, b, c, a, c, d);
    }
  }
  return _buildMesh(positions, indices, 0xa0b8c8, 'rhino-sweep2');
}

// Sweep3 — three rails. Profile is matched to the triangle formed by
// 3 rail points at each station; barycentric interp.
export function sweep3(profile, rail1, rail2, rail3, opts) {
  const segments = Math.max(2, Math.min(256, Number(opts?.segments) || 32));
  const positions = [];
  const indices = [];
  const profN = profile.length;
  // Triangle barycentric coords for each profile pt — we use 2D position
  // mapped from [-1..1] x [-1..1] to barycentric (clamped).
  function _bary(px, py) {
    const a = 1 - (px + 1) * 0.5 - (py + 1) * 0.5;
    const b = (px + 1) * 0.5;
    const c = (py + 1) * 0.5;
    return [Math.max(0, a), b, c];
  }
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const r1 = _sampleCurve(rail1, t);
    const r2 = _sampleCurve(rail2, t);
    const r3 = _sampleCurve(rail3, t);
    for (const pp of profile) {
      const [bA, bB, bC] = _bary(pp[0], pp[1]);
      const tot = bA + bB + bC || 1;
      const x = (r1.x * bA + r2.x * bB + r3.x * bC) / tot;
      const y = (r1.y * bA + r2.y * bB + r3.y * bC) / tot;
      const z = (r1.z * bA + r2.z * bB + r3.z * bC) / tot;
      positions.push(x, y, z);
    }
  }
  for (let s = 0; s < segments; s++) {
    for (let p = 0; p < profN - 1; p++) {
      const a = s * profN + p;
      const b = s * profN + p + 1;
      const c = (s + 1) * profN + p + 1;
      const d = (s + 1) * profN + p;
      indices.push(a, b, c, a, c, d);
    }
  }
  return _buildMesh(positions, indices, 0xb09aa0, 'rhino-sweep3');
}

// Variable fillet — rolling sphere blend along an edge curve with a
// per-parameter radius function. Builds a tube around the edge whose
// radius varies. Used as a stand-in surface fillet.
export function variableFillet(edge, radiusAtT, opts) {
  const segments = Math.max(8, Math.min(512, Number(opts?.segments) || 64));
  const ring = Math.max(8, Math.min(64, Number(opts?.ring) || 16));
  const positions = [];
  const indices = [];
  const radiusFn = typeof radiusAtT === 'function'
    ? radiusAtT
    : (t) => (Array.isArray(radiusAtT)
        ? radiusAtT[Math.floor(t * (radiusAtT.length - 1))]
        : Number(radiusAtT) || 0.1);
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const p = _sampleCurve(edge, t);
    const tan = _curveTangent(edge, t);
    const up = Math.abs(tan.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const side = up.clone().cross(tan).normalize();
    const newUp = tan.clone().cross(side).normalize();
    const r = Math.max(0.001, radiusFn(t));
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * Math.PI * 2;
      const dx = Math.cos(a) * r;
      const dy = Math.sin(a) * r;
      const wp = p.clone().addScaledVector(side, dx).addScaledVector(newUp, dy);
      positions.push(wp.x, wp.y, wp.z);
    }
  }
  for (let s = 0; s < segments; s++) {
    for (let k = 0; k < ring; k++) {
      const a = s * ring + k;
      const b = s * ring + ((k + 1) % ring);
      const c = (s + 1) * ring + ((k + 1) % ring);
      const d = (s + 1) * ring + k;
      indices.push(a, b, c, a, c, d);
    }
  }
  return _buildMesh(positions, indices, 0xc8b0a0, 'rhino-var-fillet');
}

function _buildMesh(positions, indices, color, name) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = name;
  if (window.__archdiscScene) window.__archdiscScene.add(mesh);
  if (typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(mesh); } catch (_) {}
  }
  return { ok: true, uuid: mesh.uuid };
}
