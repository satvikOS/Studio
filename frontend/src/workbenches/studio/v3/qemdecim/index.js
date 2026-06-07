// ArchDisc Studio V3 — Garland-Heckbert QEM decimation op surface
// (slice 786).
//
// `installQEMDecim()` wires the window.__studio* surface for the real
// QEM decimator that closes the long-standing "Decimate" PARTIAL on the
// parity map. Previous decimate paths (slice 625 `__studioDecimate`,
// slice 582 `__studioSimplifyMesh`, modstack `modDecimate`) all wrap
// `three/examples/jsm/modifiers/SimplifyModifier` — a generic edge
// collapse with no quadric error metric. This module is the FIRST real
// Garland-Heckbert QEM implementation in Studio: per-vertex 4x4
// quadric, optimal contraction position via 3x3 linear solve,
// priority-queue cost ordering, full propagation to neighbours.
//
// Op surface:
//   __studioQEMDecimate({meshUuid, targetTriRatio}) → {ok, uuid, triCount,
//                                                     error, before,
//                                                     collapsed}
//     Decimate to a fraction of the original tri count. `targetTriRatio`
//     ∈ (0, 1] is the fraction to KEEP. Falls back to the active
//     selection if `meshUuid` is omitted.
//
//   __studioQEMDecimateTo({meshUuid, targetTris}) → {ok, uuid, triCount,
//                                                    error, before,
//                                                    collapsed}
//     Decimate to an ABSOLUTE target tri count. Clamped to [4, before-1].
//
//   __studioQEMDecimateInfo({meshUuid}) → {ok, vertCount, triCount,
//                                          history?}
//     Discoverable status — useful for tests + UI tooltips.
//
// All ops register under category `edit` alongside the other geometry
// modifiers. Idempotent. Pure JS, no new deps.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
import { decimateByRatio, decimateToTriCount } from './qem.js';

let _installed = false;

function _resolveMesh(uuid) {
  const scene = window.__archdiscScene;
  if (uuid && scene) {
    const m = scene.getObjectByProperty('uuid', uuid);
    if (m) return m;
  }
  if (typeof window.__studioSelectedMesh === 'function') {
    try { return window.__studioSelectedMesh() || null; } catch (_) { return null; }
  }
  return null;
}

// Convert a THREE.BufferGeometry into (verts, tris) typed arrays the
// QEM driver consumes. Welds any duplicate verts at 1e-5 first so a
// non-indexed BoxGeometry (12 unique faces split into 36 unique verts)
// becomes a single connected mesh — without welding, every edge would
// be a boundary edge and the QEM cost would over-penalise interior
// collapses.
function _meshToFlat(geometry) {
  // Ensure indexed.
  let g = geometry.index ? geometry : geometry.toNonIndexed();
  const pos = g.attributes.position;
  if (!pos) return null;
  // Weld at 1e-5.
  const tol = 1e-5;
  const buckets = new Map();
  const remap = new Int32Array(pos.count);
  const flatVerts = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x / tol)}_${Math.round(y / tol)}_${Math.round(z / tol)}`;
    const hit = buckets.get(key);
    if (hit !== undefined) {
      remap[i] = hit;
    } else {
      const ni = flatVerts.length / 3;
      buckets.set(key, ni);
      flatVerts.push(x, y, z);
      remap[i] = ni;
    }
  }
  const srcIndex = g.index ? g.index.array : null;
  const triCount = srcIndex ? (srcIndex.length / 3) | 0 : (pos.count / 3) | 0;
  const flatTris = new Uint32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const i0 = srcIndex ? srcIndex[t*3]     : t*3;
    const i1 = srcIndex ? srcIndex[t*3 + 1] : t*3 + 1;
    const i2 = srcIndex ? srcIndex[t*3 + 2] : t*3 + 2;
    flatTris[t*3]     = remap[i0];
    flatTris[t*3 + 1] = remap[i1];
    flatTris[t*3 + 2] = remap[i2];
  }
  return {
    verts: new Float32Array(flatVerts),
    tris: flatTris,
  };
}

function _flatToBufferGeometry(verts, tris) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geom.setIndex(new THREE.BufferAttribute(tris, 1));
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

function _runQEM(mesh, opts) {
  if (!mesh || !mesh.geometry) {
    return { ok: false, error: 'no mesh' };
  }
  const flat = _meshToFlat(mesh.geometry);
  if (!flat || flat.tris.length < 12) {
    return { ok: false, error: 'mesh too small (need >= 4 tris)' };
  }
  const beforeTris = flat.tris.length / 3 | 0;
  let result;
  try {
    if (opts.mode === 'absolute') {
      result = decimateToTriCount(flat.verts, flat.tris, opts.targetTris | 0);
    } else {
      result = decimateByRatio(flat.verts, flat.tris, +opts.ratio || 0.5);
    }
  } catch (err) {
    return { ok: false, error: 'qem failed: ' + (err && err.message || err) };
  }
  // Optional undo hook.
  if (typeof window.__studioPushUndo === 'function') {
    try { window.__studioPushUndo('qem-decimate'); } catch (_) {}
  }
  const newGeom = _flatToBufferGeometry(result.verts, result.tris);
  const oldGeom = mesh.geometry;
  mesh.geometry = newGeom;
  try { oldGeom.dispose && oldGeom.dispose(); } catch (_) {}
  // Tag the mesh so the outliner / inspector / tests can confirm the
  // QEM pass ran on this primitive (matches the pattern of every other
  // v3 modifier — `archdiscStudioFoo` userData counters).
  mesh.userData = mesh.userData || {};
  mesh.userData.archdiscStudioQEMDecimated =
    (mesh.userData.archdiscStudioQEMDecimated || 0) + 1;
  mesh.userData.archdiscStudioQEMBefore = beforeTris;
  mesh.userData.archdiscStudioQEMAfter  = result.triCount;
  mesh.userData.archdiscStudioQEMError  = result.error;
  // Optional toast.
  if (typeof window.__studioToast === 'function') {
    try {
      window.__studioToast(
        `QEM decimate ${beforeTris} → ${result.triCount} tris (err ${result.error.toExponential(2)})`,
        'ok'
      );
    } catch (_) {}
  }
  return {
    ok: true,
    uuid: mesh.uuid,
    before: beforeTris,
    triCount: result.triCount,
    vertCount: result.vertCount,
    error: result.error,
    collapsed: result.collapsed,
  };
}

export function installQEMDecim() {
  if (_installed) return { ok: true, already: true };
  _installed = true;

  const ops = {
    __studioQEMDecimate: (o) => {
      const opts = o || {};
      const mesh = _resolveMesh(opts.meshUuid);
      const ratio = (opts.targetTriRatio !== undefined)
        ? +opts.targetTriRatio
        : (opts.ratio !== undefined ? +opts.ratio : 0.5);
      return _runQEM(mesh, { mode: 'ratio', ratio });
    },
    __studioQEMDecimateTo: (o) => {
      const opts = o || {};
      const mesh = _resolveMesh(opts.meshUuid);
      const targetTris = (opts.targetTris !== undefined)
        ? (opts.targetTris | 0)
        : 100;
      return _runQEM(mesh, { mode: 'absolute', targetTris });
    },
    __studioQEMDecimateInfo: (o) => {
      const opts = o || {};
      const mesh = _resolveMesh(opts.meshUuid);
      if (!mesh || !mesh.geometry) return { ok: false, error: 'no mesh' };
      const pos = mesh.geometry.attributes.position;
      const idx = mesh.geometry.index;
      const ud = mesh.userData || {};
      return {
        ok: true,
        uuid: mesh.uuid,
        vertCount: pos ? pos.count : 0,
        triCount: idx ? (idx.count / 3) | 0 : (pos ? (pos.count / 3) | 0 : 0),
        history: {
          runs:   ud.archdiscStudioQEMDecimated || 0,
          before: ud.archdiscStudioQEMBefore || 0,
          after:  ud.archdiscStudioQEMAfter  || 0,
          error:  ud.archdiscStudioQEMError  || 0,
        },
      };
    },
  };
  for (const [name, fn] of Object.entries(ops)) window[name] = fn;
  registerOps(
    ops, 'edit',
    'Garland-Heckbert quadric error metric (QEM) mesh decimation'
  );
  return { ok: true };
}

export default installQEMDecim;
