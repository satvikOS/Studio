// ArchDisc Studio V3 — hair-strand renderers (slice 760).
//
// Two render modes mirror the DCC industry split:
//
//   • buildStrandLineMesh(strands)        →  THREE.LineSegments
//     One pair of vertices per segment, packed into a single
//     BufferGeometry. Cheap; reads as guide-curve preview, matches
//     XGen / Groom guide draw and Blender's "Path" hair display.
//
//   • buildStrandRibbonMesh(strands, w)   →  THREE.Mesh
//     Per strand, build a screen-aligned ribbon: at each control point
//     pick a stable side-vector (cross of the segment direction and a
//     reference up), expand ±w/2 along it, emit one quad per segment.
//     Indexed BufferGeometry; one shared MeshBasicMaterial. Matches
//     Unreal Groom's "card hair" preview and Maya XGen's "Render
//     Strands as Ribbons" toggle.
//
// Both renderers return a fully-shaped THREE Object3D so the installer
// can drop the mesh straight into the scene. They are pure functions:
// strand data is the source of truth — when the caller mutates strands
// (comb / length / densify) they re-call the matching builder and swap
// the geometry on the mesh. No animation loop hook needed.

import * as THREE from 'three';

// ─── Helpers ──────────────────────────────────────────────────────────
// Pick a side vector orthogonal to `dir` using a reference axis. Falls
// back to a different axis if the cross is degenerate, so vertical and
// horizontal strands both get a stable ribbon plane.
function _sideVector(dir, out, tmp) {
  // dir is unit-ish. Try world up first; switch to world right if the
  // segment is too parallel to up.
  const ax = Math.abs(dir.y);
  if (ax < 0.9) {
    tmp.set(0, 1, 0);
  } else {
    tmp.set(1, 0, 0);
  }
  out.crossVectors(dir, tmp);
  const l = out.length();
  if (l > 1e-12) out.multiplyScalar(1 / l);
  else out.set(1, 0, 0);
  return out;
}

// ─── buildStrandLineMesh ─────────────────────────────────────────────
// strands → THREE.LineSegments (two vertices per segment, no indexing).
//
// `positions` length = `sum(strand.points.length - 1) * 2 * 3`.
// Single MaterialBasicLine, no vertex colours — the caller can wrap
// this in a userData tag and recolour by editing the material.
export function buildStrandLineMesh(strands) {
  let segTotal = 0;
  if (Array.isArray(strands)) {
    for (const s of strands) {
      if (!s || !Array.isArray(s.points)) continue;
      segTotal += Math.max(0, s.points.length - 1);
    }
  }
  const positions = new Float32Array(segTotal * 2 * 3);
  let ptr = 0;
  if (Array.isArray(strands)) {
    for (const s of strands) {
      if (!s || !Array.isArray(s.points) || s.points.length < 2) continue;
      const pts = s.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        positions[ptr++] = a.x;
        positions[ptr++] = a.y;
        positions[ptr++] = a.z;
        positions[ptr++] = b.x;
        positions[ptr++] = b.y;
        positions[ptr++] = b.z;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x442211 });
  const mesh = new THREE.LineSegments(geo, mat);
  mesh.name = 'archdisc-groom-lines';
  mesh.userData.archdiscStudioGroom = true;
  mesh.userData.archdiscStudioGroomMode = 'lines';
  return mesh;
}

// ─── buildStrandRibbonMesh ───────────────────────────────────────────
// strands → THREE.Mesh of camera-facing-ish ribbon strips, one strip
// per strand. Ribbons are double-sided so both faces render under any
// camera rotation; uniform `width` along the strand (no taper — that's
// the next slice if anyone asks).
//
// Per strand:
//   • compute a side vector at each control point from segment dir
//   • emit `points.length` quads worth of vertices (top + bot)
//   • indexed connectivity: for each segment i, two triangles
//     (i,top → i+1,top → i+1,bot) and (i,top → i+1,bot → i,bot)
export function buildStrandRibbonMesh(strands, width) {
  const w = Math.max(0, +width || 0.003);
  let vertTotal = 0;
  let triTotal = 0;
  if (Array.isArray(strands)) {
    for (const s of strands) {
      if (!s || !Array.isArray(s.points) || s.points.length < 2) continue;
      vertTotal += s.points.length * 2;     // top+bot per control point
      triTotal += (s.points.length - 1) * 2; // 2 tris per segment
    }
  }
  const positions = new Float32Array(vertTotal * 3);
  const normals = new Float32Array(vertTotal * 3);
  const indices = (vertTotal > 65535)
    ? new Uint32Array(triTotal * 3)
    : new Uint16Array(triTotal * 3);
  let vPtr = 0;
  let iPtr = 0;
  const segDir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const nrm = new THREE.Vector3();

  if (Array.isArray(strands)) {
    for (const s of strands) {
      if (!s || !Array.isArray(s.points) || s.points.length < 2) continue;
      const pts = s.points;
      const baseV = vPtr / 3;
      for (let i = 0; i < pts.length; i++) {
        // Segment direction at i: use forward segment when possible,
        // otherwise the preceding one (tip).
        if (i < pts.length - 1) {
          segDir.set(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y, pts[i + 1].z - pts[i].z);
        } else {
          segDir.set(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
        }
        if (segDir.lengthSq() > 1e-20) segDir.normalize();
        else segDir.set(0, 1, 0);
        _sideVector(segDir, side, tmp);
        const sx = side.x * (w * 0.5);
        const sy = side.y * (w * 0.5);
        const sz = side.z * (w * 0.5);
        const p = pts[i];
        // Top vertex (+side).
        positions[vPtr]     = p.x + sx;
        positions[vPtr + 1] = p.y + sy;
        positions[vPtr + 2] = p.z + sz;
        // Bot vertex (−side).
        positions[vPtr + 3] = p.x - sx;
        positions[vPtr + 4] = p.y - sy;
        positions[vPtr + 5] = p.z - sz;
        // Normal: cross(segDir, side) — points "out" of the ribbon.
        nrm.crossVectors(segDir, side);
        if (nrm.lengthSq() > 1e-20) nrm.normalize();
        else nrm.set(0, 1, 0);
        normals[vPtr]     = nrm.x;
        normals[vPtr + 1] = nrm.y;
        normals[vPtr + 2] = nrm.z;
        normals[vPtr + 3] = nrm.x;
        normals[vPtr + 4] = nrm.y;
        normals[vPtr + 5] = nrm.z;
        vPtr += 6;
      }
      // Build indices: per segment two tris.
      for (let i = 0; i < pts.length - 1; i++) {
        const a = baseV + i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        // tri 1: a → c → d
        indices[iPtr++] = a;
        indices[iPtr++] = c;
        indices[iPtr++] = d;
        // tri 2: a → d → b
        indices[iPtr++] = a;
        indices[iPtr++] = d;
        indices[iPtr++] = b;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x442211,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'archdisc-groom-ribbons';
  mesh.userData.archdiscStudioGroom = true;
  mesh.userData.archdiscStudioGroomMode = 'ribbons';
  return mesh;
}

export default buildStrandLineMesh;
