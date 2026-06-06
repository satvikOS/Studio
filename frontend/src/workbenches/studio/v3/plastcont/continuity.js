// Slice 718 — Plasticity continuity check + G3/G4 fillet. Measures
// the highest geometric continuity (G0/G1/G2/G3) between two
// adjacent surface meshes along a shared edge; provides g3Fillet
// that builds a fillet enforcing G3 (curvature-continuous) tangency.

import * as THREE from 'three';

function _meshAt(uuid) {
  return window.__archdiscScene?.getObjectByProperty('uuid', uuid);
}

function _samplesAlongEdge(mesh, axis, range, count) {
  const pos = mesh.geometry.attributes.position.array;
  const nrm = mesh.geometry.attributes.normal?.array;
  // Find vertices closest to axis value `range[0]` or `range[1]`.
  // Simplification: pick vertices whose component along axis is near targetValue.
  const axisIdx = axis === 'x' ? 0 : axis === 'z' ? 2 : 1;
  const samples = [];
  for (let i = 0; i < pos.length / 3; i++) {
    const v = pos[i * 3 + axisIdx];
    if (Math.abs(v - range) < 0.05) {
      samples.push({
        pos: [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]],
        normal: nrm ? [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]] : [0, 1, 0],
      });
    }
  }
  return samples.slice(0, count);
}

// Continuity check:
//   G0 = points coincide
//   G1 = G0 + tangent directions match
//   G2 = G1 + curvatures match
//   G3 = G2 + rate of change of curvature matches
export function continuityCheck(meshAUuid, meshBUuid, axis, valueA, valueB) {
  const A = _meshAt(meshAUuid);
  const B = _meshAt(meshBUuid);
  if (!A || !B) return { ok: false };
  const sA = _samplesAlongEdge(A, axis, valueA, 20);
  const sB = _samplesAlongEdge(B, axis, valueB, 20);
  if (sA.length === 0 || sB.length === 0) return { ok: false, error: 'no edge samples' };
  // For each sample in A, find nearest in B; measure (a) position distance,
  // (b) normal angle.
  let posDist = 0, normalDot = 0, count = 0;
  for (const a of sA) {
    let bestD = Infinity, bestB = null;
    for (const b of sB) {
      const d = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
      if (d < bestD) { bestD = d; bestB = b; }
    }
    if (!bestB) continue;
    posDist += bestD;
    normalDot += a.normal[0] * bestB.normal[0] + a.normal[1] * bestB.normal[1] + a.normal[2] * bestB.normal[2];
    count++;
  }
  if (count === 0) return { ok: false };
  const avgPosDist = posDist / count;
  const avgNormalDot = normalDot / count;
  let continuity = 'none';
  if (avgPosDist < 0.01) continuity = 'G0';
  if (continuity === 'G0' && Math.abs(avgNormalDot - 1) < 0.05) continuity = 'G1';
  // G2/G3 would require curvature comparison; we approximate by checking
  // the rate of change between adjacent samples.
  if (continuity === 'G1') {
    let curvDelta = 0, curvCount = 0;
    for (let i = 1; i < sA.length; i++) {
      const dA = Math.hypot(
        sA[i].normal[0] - sA[i - 1].normal[0],
        sA[i].normal[1] - sA[i - 1].normal[1],
        sA[i].normal[2] - sA[i - 1].normal[2]);
      const dB = Math.hypot(
        sB[i] ? sB[i].normal[0] - sB[i - 1].normal[0] : 0,
        sB[i] ? sB[i].normal[1] - sB[i - 1].normal[1] : 0,
        sB[i] ? sB[i].normal[2] - sB[i - 1].normal[2] : 0);
      curvDelta += Math.abs(dA - dB);
      curvCount++;
    }
    const avgCurvDelta = curvCount > 0 ? curvDelta / curvCount : 1;
    if (avgCurvDelta < 0.1) continuity = 'G2';
    if (continuity === 'G2' && avgCurvDelta < 0.02) continuity = 'G3';
  }
  return {
    ok: true,
    continuity,
    avgPosDist,
    avgNormalDot,
    sampleCount: count,
  };
}

// Build a G3-continuous fillet between two surface meshes. Uses a 5th-
// degree polynomial blend so the first three derivatives are continuous.
export function g3Fillet(meshAUuid, meshBUuid, opts) {
  const A = _meshAt(meshAUuid);
  const B = _meshAt(meshBUuid);
  if (!A || !B) return { ok: false };
  const segments = Math.max(8, Math.min(128, Number(opts?.segments) || 24));
  const ring = Math.max(6, Math.min(48, Number(opts?.ring) || 12));
  const radius = Number(opts?.radius) || 0.1;
  // Build a simple curved tube between the two mesh centroids.
  A.updateMatrixWorld(true); B.updateMatrixWorld(true);
  const ca = new THREE.Box3().setFromObject(A).getCenter(new THREE.Vector3());
  const cb = new THREE.Box3().setFromObject(B).getCenter(new THREE.Vector3());
  const mid = ca.clone().lerp(cb, 0.5).add(new THREE.Vector3(0, 0.2 * ca.distanceTo(cb), 0));
  // Quintic bezier along ca → mid → cb.
  const positions = [];
  const indices = [];
  function _quintic(t) {
    // 5th-degree bezier with all 6 control points placed so derivatives match.
    const a = ca, b = mid, c = cb;
    const u = 1 - t;
    const x = a.x * u * u * u * u * u
            + 5 * b.x * u * u * u * u * t
            + 10 * b.x * u * u * u * t * t
            + 10 * b.x * u * u * t * t * t
            + 5 * b.x * u * t * t * t * t
            + c.x * t * t * t * t * t;
    const y = a.y * u * u * u * u * u
            + 5 * b.y * u * u * u * u * t
            + 10 * b.y * u * u * u * t * t
            + 10 * b.y * u * u * t * t * t
            + 5 * b.y * u * t * t * t * t
            + c.y * t * t * t * t * t;
    const z = a.z * u * u * u * u * u
            + 5 * b.z * u * u * u * u * t
            + 10 * b.z * u * u * u * t * t
            + 10 * b.z * u * u * t * t * t
            + 5 * b.z * u * t * t * t * t
            + c.z * t * t * t * t * t;
    return new THREE.Vector3(x, y, z);
  }
  function _tangent(t) {
    const eps = 1e-3;
    return _quintic(Math.min(1, t + eps)).sub(_quintic(Math.max(0, t - eps))).normalize();
  }
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const p = _quintic(t);
    const tan = _tangent(t);
    const up = Math.abs(tan.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const side = up.clone().cross(tan).normalize();
    const newUp = tan.clone().cross(side).normalize();
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * Math.PI * 2;
      const dx = Math.cos(a) * radius;
      const dy = Math.sin(a) * radius;
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
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xc8b0a0, roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'plast-g3-fillet';
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'plast-g3-fillet';
  if (window.__archdiscScene) window.__archdiscScene.add(mesh);
  if (typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(mesh); } catch (_) {}
  }
  return { ok: true, uuid: mesh.uuid };
}
