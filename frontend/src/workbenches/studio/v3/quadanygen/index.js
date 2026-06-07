// ArchDisc Studio V3 — slice 779.
//
// Singularity-aware integer-grid quad remesh on arbitrary-genus
// triangle meshes (Instant Meshes / ZRemesher parity). Closes the
// "parametric (disk-topology) surfaces only" scope that the
// slice-177 `fieldAlignedQuad.js` had.
//
// Op surface:
//
//   __studioQuadAnyGenRemesh({meshUuid, targetQuadCount}) → {
//     ok, uuid, quadCount, singularityCount, vertexCount,
//     tJunction3, tJunction5, cuts
//   }
//     Remesh the named (or active) mesh in-place. The result is a
//     pure-quad geometry (rendered as two-triangles-per-quad on the
//     wire so three.js can shade it) that respects the surface's
//     principal-curvature flow AND its topology — torus knots, double
//     handles, holes, etc. all parameterise correctly because the
//     streamline-BFS detects fundamental-cycle wraps as CUTS and the
//     extraction handles 3-/5-valent T-junctions at the cones.
//
//   __studioQuadAnyGenAnalyzeField({meshUuid}) → {
//     ok, singularities, vertexCount
//   }
//     Run the cross-field estimate + RoSy-4 smoothing + singularity
//     detection on the mesh without remeshing — useful for previewing
//     cone locations before committing to the new topology.
//
// All ops are idempotent against double-install. Registered under the
// `mesh` palette category.

import * as THREE from 'three';
import { registerOps, unregisterOps } from '../common/registry.js';
import { computeCrossField } from './crossField.js';
import { streamlineParameterise } from './integerGrid.js';
import { extractQuads } from './quadExtract.js';

let _installed = false;

function _scene() {
  return window.__archdiscScene
      || (window.__archdiscViewport && window.__archdiscViewport.scene)
      || null;
}
function _activeMesh() {
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}
function _findMeshByUuid(uuid) {
  if (!uuid) return null;
  const s = _scene(); if (!s) return null;
  let m = null;
  s.traverse((o) => { if (o.isMesh && o.uuid === uuid) m = o; });
  return m;
}

// ─── Pull positions + indices from a three.js mesh, world-baked ──────
function _meshArrays(mesh) {
  if (!mesh || !mesh.geometry) return null;
  let g = mesh.geometry;
  if (!g.index) {
    // Build a sequential index so we can run the cross-field on triangle
    // soup uniformly. (No need to weld here — `buildAdjacency` works on
    // the index buffer; coincident verts read as separate islands which
    // is correct for the streamline BFS.)
    const N = g.attributes.position.count;
    const seq = new Uint32Array(N);
    for (let i = 0; i < N; i++) seq[i] = i;
    g = g.clone();
    g.setIndex(new THREE.BufferAttribute(seq, 1));
  }
  // Bake world transform so the remesh result lives in the same scene
  // coordinates as the source — without this a rotated torus comes back
  // unrotated.
  mesh.updateMatrixWorld(true);
  const baked = g.clone();
  baked.applyMatrix4(mesh.matrixWorld);
  return {
    positions: baked.attributes.position.array,
    indices: baked.index.array,
    geom: baked,
  };
}

// Try to weld coincident vertices in the source so a TorusGeometry
// (which has a duplicated seam) becomes a single-component closed
// surface for the cross-field smoothing. This is what makes the
// "arbitrary genus" guarantee real — without welding, a TorusGeometry's
// seam vertices give the streamline BFS two disconnected charts.
function _weldVertices(positions, indices, eps) {
  const e = eps != null ? eps : 1e-5;
  const Vn = (positions.length / 3) | 0;
  const grid = new Map();
  const remap = new Int32Array(Vn);
  const outPos = [];
  for (let i = 0; i < Vn; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const key = Math.round(x / e) + ',' + Math.round(y / e) + ',' + Math.round(z / e);
    let id = grid.get(key);
    if (id == null) {
      id = outPos.length / 3;
      grid.set(key, id);
      outPos.push(x, y, z);
    }
    remap[i] = id;
  }
  const outIdx = new Uint32Array(indices.length);
  let writeI = 0;
  for (let t = 0; t < indices.length / 3; t++) {
    const a = remap[indices[t * 3]];
    const b = remap[indices[t * 3 + 1]];
    const c = remap[indices[t * 3 + 2]];
    if (a === b || b === c || c === a) continue; // degenerate after weld
    outIdx[writeI++] = a; outIdx[writeI++] = b; outIdx[writeI++] = c;
  }
  return {
    positions: new Float32Array(outPos),
    indices: outIdx.subarray(0, writeI),
  };
}

// ─── Op: remesh ──────────────────────────────────────────────────────

function opRemesh(opts) {
  const o = opts || {};
  const s = _scene(); if (!s) return { ok: false, error: 'no scene' };
  const mesh = (o.meshUuid && _findMeshByUuid(o.meshUuid)) || _activeMesh();
  if (!mesh || !mesh.geometry) return { ok: false, error: 'no mesh' };
  const arr = _meshArrays(mesh);
  if (!arr) return { ok: false, error: 'mesh has no geometry arrays' };
  const welded = _weldVertices(arr.positions, arr.indices, o.weldEps != null ? +o.weldEps : 1e-5);
  if (welded.positions.length < 9 || welded.indices.length < 3) {
    return { ok: false, error: 'mesh too small after weld' };
  }
  // ── 1. Cross-field on the welded mesh ──
  const targetQuadCount = Math.max(16, (o.targetQuadCount | 0) || 256);
  const { theta, adj, normals, e1, e2, singularities } =
    computeCrossField(welded.positions, welded.indices, {
      smoothIters: o.smoothIters != null ? (o.smoothIters | 0) : 14,
    });
  // ── 2. Integer-grid parameterisation by streamline-BFS ──
  // Pick edge length so the resulting (u, v) range yields ~targetQuadCount
  // cells. The current uv span is ≈ surface span / mean edge length;
  // scaling targetEdgeLength inversely with sqrt(quads) gets us close.
  // Empirically tuned: for a unit torus mean edge length ≈ 0.16, at
  // target = 256 quads we want UV span ≈ 16, so targetEdgeLength ≈ 0.1.
  let bbox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < welded.positions.length; i += 3) {
    if (welded.positions[i] < bbox.minX) bbox.minX = welded.positions[i];
    if (welded.positions[i] > bbox.maxX) bbox.maxX = welded.positions[i];
    if (welded.positions[i + 1] < bbox.minY) bbox.minY = welded.positions[i + 1];
    if (welded.positions[i + 1] > bbox.maxY) bbox.maxY = welded.positions[i + 1];
    if (welded.positions[i + 2] < bbox.minZ) bbox.minZ = welded.positions[i + 2];
    if (welded.positions[i + 2] > bbox.maxZ) bbox.maxZ = welded.positions[i + 2];
  }
  const diag = Math.hypot(
    bbox.maxX - bbox.minX,
    bbox.maxY - bbox.minY,
    bbox.maxZ - bbox.minZ,
  );
  // The (u, v) grid covers ≈ surface area / cell area integer cells.
  // For an axis-aligned surface that's roughly diag²/cell². So pick
  // cell ≈ diag / sqrt(targetQuadCount).
  const targetEdgeLength = o.targetEdgeLength != null
    ? +o.targetEdgeLength
    : diag / Math.sqrt(targetQuadCount);
  const param = streamlineParameterise(
    welded.positions, welded.indices, theta, adj, normals, e1, e2,
    singularities,
    { targetEdgeLength },
  );
  // ── 3. Quad extraction ──
  const remesh = extractQuads(
    welded.positions, welded.indices, param.U, param.V,
    { maxSpan: 256 },
  );
  if (remesh.quadCount === 0) {
    return { ok: false, error: 'integer-grid extraction produced no quads' };
  }
  // ── 4. Replace the mesh's geometry ──
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(remesh.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(remesh.normals, 3));
  geo.setIndex(new THREE.BufferAttribute(remesh.triIndex, 1));
  // computeVertexNormals would overwrite our averaged normals; recompute
  // from triangles for shading accuracy.
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  // The source mesh's world matrix is already baked into the new
  // positions, so reset the mesh transform.
  if (mesh.geometry) mesh.geometry.dispose();
  mesh.geometry = geo;
  mesh.position.set(0, 0, 0);
  mesh.quaternion.identity();
  mesh.scale.set(1, 1, 1);
  mesh.updateMatrix();
  mesh.updateMatrixWorld(true);
  mesh.userData.archdiscQuadAnyGen = {
    quadCount: remesh.quadCount,
    vertexCount: remesh.vertexCount,
    singularityCount: singularities.length,
    tJunction3: remesh.tJunction3,
    tJunction5: remesh.tJunction5,
    cutCount: param.cuts.length,
    targetEdgeLength: param.targetEdgeLength,
  };
  mesh.userData.archdiscQuads = remesh.quads;
  return {
    ok: true,
    uuid: mesh.uuid,
    quadCount: remesh.quadCount,
    vertexCount: remesh.vertexCount,
    singularityCount: singularities.length,
    tJunction3: remesh.tJunction3,
    tJunction5: remesh.tJunction5,
    cuts: param.cuts.length,
    cones: param.cones.length,
    targetEdgeLength: param.targetEdgeLength,
  };
}

// ─── Op: analyse field only (preview cones, no remesh) ───────────────

function opAnalyzeField(opts) {
  const o = opts || {};
  const mesh = (o.meshUuid && _findMeshByUuid(o.meshUuid)) || _activeMesh();
  if (!mesh || !mesh.geometry) return { ok: false, error: 'no mesh' };
  const arr = _meshArrays(mesh);
  if (!arr) return { ok: false, error: 'mesh has no geometry arrays' };
  const welded = _weldVertices(arr.positions, arr.indices, o.weldEps != null ? +o.weldEps : 1e-5);
  if (welded.positions.length < 9) return { ok: false, error: 'mesh too small' };
  const { singularities } = computeCrossField(welded.positions, welded.indices, {
    smoothIters: o.smoothIters != null ? (o.smoothIters | 0) : 14,
  });
  return {
    ok: true,
    vertexCount: (welded.positions.length / 3) | 0,
    singularities: singularities.map((s) => ({
      vertex: s.vertex,
      index: s.index,
      position: s.position.slice(),
    })),
  };
}

// ─── Install / uninstall ─────────────────────────────────────────────

const OP_NAMES = [
  '__studioQuadAnyGenRemesh',
  '__studioQuadAnyGenAnalyzeField',
];

export function installQuadAnyGen() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioQuadAnyGenInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioQuadAnyGenInstalled = true;
  const ops = {
    __studioQuadAnyGenRemesh: [
      opRemesh,
      'Singularity-aware integer-grid quad remesh on arbitrary-genus meshes (Instant Meshes / ZRemesher).',
    ],
    __studioQuadAnyGenAnalyzeField: [
      opAnalyzeField,
      'Analyse the principal-curvature cross-field on a mesh and report singularity (cone) positions without remeshing.',
    ],
  };
  registerOps(ops, 'mesh',
    'Slice 779 — Instant Meshes / ZRemesher: arbitrary-genus quad remesh with cones + cuts.');
  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallQuadAnyGen() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  unregisterOps(OP_NAMES);
  _installed = false;
  window.__studioQuadAnyGenInstalled = false;
  return { ok: true };
}

export default installQuadAnyGen;
