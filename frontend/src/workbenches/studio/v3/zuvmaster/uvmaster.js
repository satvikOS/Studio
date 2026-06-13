// Slice 721 — ZBrush UV Master. One-click UV unwrap that picks a
// "seam path" automatically (longest geodesic from a chosen pole),
// runs angle-based parameterization (LSCM-lite), and packs islands.
// Mirrors ZBrush UV Master's "Unwrap All" button.

import * as THREE from 'three';
import { lscmUnwrap, uvAngleDistortion } from './lscm.js';
import { autoSeamUnwrap, segmentCharts } from './seams.js';

function _vec(p, i) { return new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); }

function _pickPoleVertex(positions) {
  // Pick the vertex with the highest +Y as the pole.
  let best = 0;
  let bestY = -Infinity;
  for (let i = 0; i < positions.length / 3; i++) {
    if (positions[i * 3 + 1] > bestY) { bestY = positions[i * 3 + 1]; best = i; }
  }
  return best;
}

function _greedyUnwrap(positions, indices) {
  // Simple spherical projection from the centroid. Each vertex's UV is its
  // (azimuth, polar) angle scaled to [0,1]. Adequate for simple meshes.
  const n = positions.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    cx += positions[i * 3];
    cy += positions[i * 3 + 1];
    cz += positions[i * 3 + 2];
  }
  cx /= n; cy /= n; cz /= n;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const dx = positions[i * 3] - cx;
    const dy = positions[i * 3 + 1] - cy;
    const dz = positions[i * 3 + 2] - cz;
    const az = Math.atan2(dz, dx);   // [-π..π]
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const polar = Math.acos(dy / r);  // [0..π]
    uv[i * 2]     = (az + Math.PI) / (2 * Math.PI);
    uv[i * 2 + 1] = polar / Math.PI;
  }
  return uv;
}

function _angleBasedRelax(positions, indices, uv, iterations) {
  // For each iteration, push each UV toward the centroid of its 1-ring,
  // reducing distortion. Coarse approximation of LSCM relaxation.
  const n = positions.length / 3;
  const idx = indices;
  const triCount = idx ? idx.length / 3 : n / 3;
  const neighbors = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3] : t * 3;
    const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    neighbors[i0].add(i1); neighbors[i0].add(i2);
    neighbors[i1].add(i0); neighbors[i1].add(i2);
    neighbors[i2].add(i0); neighbors[i2].add(i1);
  }
  for (let it = 0; it < iterations; it++) {
    const newUV = new Float32Array(uv);
    for (let i = 0; i < n; i++) {
      const ns = neighbors[i];
      if (ns.size === 0) continue;
      let u = 0, v = 0;
      for (const nb of ns) { u += uv[nb * 2]; v += uv[nb * 2 + 1]; }
      u /= ns.size; v /= ns.size;
      newUV[i * 2]     = uv[i * 2]     * 0.5 + u * 0.5;
      newUV[i * 2 + 1] = uv[i * 2 + 1] * 0.5 + v * 0.5;
    }
    uv.set(newUV);
  }
  return uv;
}

export function unwrapAll(meshUuid, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry?.attributes?.position) return { ok: false };
  const pos = mesh.geometry.attributes.position.array;
  const idx = mesh.geometry.index?.array;
  // Slice 734 — real LSCM (Least Squares Conformal Maps) is the primary
  // unwrap: it minimises ANGLE distortion (Blender/Maya 'Unwrap'). Fall
  // back to spherical projection only if the conformal solve fails
  // (degenerate / collapsed mesh).
  let uv = null;
  let method = 'lscm';
  const lscm = lscmUnwrap(pos, idx);
  if (lscm.ok) {
    uv = lscm.uv;
  } else {
    method = 'projection';
    uv = _greedyUnwrap(pos, idx);
    const iterations = Math.max(0, Math.min(20, Number(opts?.relax) || 5));
    if (iterations > 0) uv = _angleBasedRelax(pos, idx, uv, iterations);
  }
  mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // Pack the result via slice-719 uvpack if installed.
  if (typeof window.__studioUVPackIslands === 'function') {
    try { window.__studioUVPackIslands(meshUuid, { margin: 0.01 }); } catch (_) {}
  }
  return { ok: true, vertices: uv.length / 2, method, fallbackReason: lscm.ok ? undefined : lscm.reason };
}

export function setControlPainting(meshUuid, opts) {
  // ZBrush UV Master allows users to paint hint colors (red = avoid seam,
  // green = force seam) on the mesh to bias the unwrap. We store the
  // user's color hints in userData; on next unwrapAll, we'd weight the
  // seam path based on these hints. (Stub kept simple — full LSCM out
  // of scope.)
  const scene = window.__archdiscScene;
  const mesh = scene?.getObjectByProperty('uuid', meshUuid);
  if (!mesh) return { ok: false };
  if (!mesh.userData) mesh.userData = {};
  mesh.userData.archdiscUVMasterHints = opts?.hints || null;
  return { ok: true };
}

export function pickPole(meshUuid) {
  const scene = window.__archdiscScene;
  const mesh = scene?.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry?.attributes?.position) return { ok: false };
  return { ok: true, vertex: _pickPoleVertex(mesh.geometry.attributes.position.array) };
}

// Slice 734 — report the mean angle distortion (degrees) of a mesh's
// CURRENT UVs. 0 = perfectly conformal. Lets users + tests quantify
// unwrap quality (LSCM should be near-zero on developable surfaces).
export function unwrapDistortion(meshUuid) {
  const scene = window.__archdiscScene;
  const mesh = scene?.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry?.attributes?.position) return { ok: false };
  const uv = mesh.geometry.attributes.uv;
  if (!uv) return { ok: false, reason: 'mesh has no UVs — unwrap first' };
  const pos = mesh.geometry.attributes.position.array;
  const idx = mesh.geometry.index?.array;
  const deg = uvAngleDistortion(pos, idx, uv.array);
  return { ok: true, meanAngleDistortionDeg: deg };
}

// Slice 736 — automatic SEAM-CUT unwrap: detect sharp-edge seams, segment
// the mesh into developable charts, LSCM-flatten each, and lay them out.
// Required for CLOSED meshes (a box, a character) that a single-chart
// LSCM can't flatten without massive distortion. (Blender Smart UV
// Project / Maya Automatic / ZBrush UV Master auto-seam.)
export function unwrapWithSeams(meshUuid, opts) {
  const scene = window.__archdiscScene;
  const mesh = scene?.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry?.attributes?.position) return { ok: false };
  const pos = mesh.geometry.attributes.position.array;
  const idx = mesh.geometry.index?.array
    || (() => { const n = pos.length / 3; const a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; })();
  // Slice 960 — painted seams (__studioMarkEdgeSeam → userData.studioSeamEdges)
  // merge into the cut. opts.markedOnly cuts ONLY along painted seams
  // (Blender unwrap-with-marked-seams); the unwrap rebuilds geometry with
  // per-chart vertex copies, so paint seams BEFORE unwrapping — vertex
  // indices change after the cut.
  const marked = (opts?.useMarkedSeams !== false && mesh.userData?.studioSeamEdges?.size)
    ? Array.from(mesh.userData.studioSeamEdges) : null;
  const r = autoSeamUnwrap(pos, idx, {
    seamAngleDeg: opts?.markedOnly ? null : (Number(opts?.seamAngleDeg) || 40),
    userSeams: marked,
  });
  if (!r.ok) return r;
  // The seam unwrap returns an EXPANDED geometry (per-chart vertex copies)
  // so charts don't share UVs across seams — rebuild the mesh from it.
  const g = mesh.geometry;
  g.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(r.uv, 2));
  g.setIndex(new THREE.BufferAttribute(r.indices, 1));
  if (g.attributes.normal) g.deleteAttribute('normal');
  g.computeVertexNormals();
  g.computeBoundingSphere();
  if (mesh.userData?.studioSeamEdges) mesh.userData.studioSeamEdges.clear(); // indices changed — stale keys are lies
  return { ok: true, method: 'seam-lscm', charts: r.charts, seamCount: r.seamCount,
           paintedUsed: r.paintedUsed || 0, flattenedCharts: r.flattenedCharts };
}

// Slice 736 — report how many seam-bounded charts a mesh would segment
// into at a given dihedral-angle threshold (no UV write).
export function chartCount(meshUuid, seamAngleDeg) {
  const scene = window.__archdiscScene;
  const mesh = scene?.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry?.attributes?.position) return { ok: false };
  const pos = mesh.geometry.attributes.position.array;
  const idx = mesh.geometry.index?.array
    || (() => { const n = pos.length / 3; const a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; })();
  const seg = segmentCharts(pos, idx, Number(seamAngleDeg) || 40);
  return { ok: true, charts: seg.charts.length, seamCount: seg.seamCount };
}
