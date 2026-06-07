// ArchDisc Studio V3 — Parasolid-tier tolerant boolean op surface
// (slice 781).
//
// `installBoolTol()` wires the window.__studioBoolTol* op surface that
// runs the preheal → CSG → posthealed pipeline from ./tolBoolean.js on
// scene meshes. Closes the long-standing "imported / scanned mesh blows
// up the boolean" gap — Parasolid's tolerant-modelling path runs the
// equivalent heal pre-pass before every operation.
//
// Op surface (all entries take a SINGLE options object so callers don't
// have to remember argument order; matches the slice-786 qemdecim style):
//
//   __studioBoolTolUnion({meshAUuid, meshBUuid, tol?})
//     → {ok, uuid, verts, diagnostics, op:'union'}
//   __studioBoolTolDifference({meshAUuid, meshBUuid, tol?})
//     → {ok, uuid, verts, diagnostics, op:'difference'}
//   __studioBoolTolIntersection({meshAUuid, meshBUuid, tol?})
//     → {ok, uuid, verts, diagnostics, op:'intersect'}
//   __studioBoolTolHeal({meshUuid, tol?})
//     → {ok, uuid, verts, diagnostics, op:'heal'}
//
// Differences vs slice 691 __studioCSG*:
//   • Inputs are pre-healed (weld + sliver-drop + hole-fill + coplanar
//     grouping) before the boolean, so imported / scanned / hand-stitched
//     meshes survive without immediate failure.
//   • Default tol is 1e-5 (Parasolid's typical "session tolerance" for
//     mm-scale models).
//   • The result is post-welded so coincident-face seams don't leave
//     hairline cracks visible in the renderer.
//   • Falls back to a best-effort merge for tolerantUnion if the
//     manifold-3d module fails to load (diagnostics.fallback = true).
//
// All ops register under category `edit` alongside the other geometry
// modifiers. Idempotent.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
import {
  tolerantUnion,
  tolerantDifference,
  tolerantIntersection,
  tolerantHeal,
} from './tolBoolean.js';

let _installed = false;

function _findMeshByUuid(uuid) {
  const scene = (typeof window !== 'undefined') ? window.__archdiscScene : null;
  if (!scene || !uuid) return null;
  let hit = null;
  scene.traverse((o) => {
    if (!hit && o.isMesh && o.uuid === uuid) hit = o;
  });
  return hit;
}

function _resolvePair(uuidA, uuidB) {
  let a = _findMeshByUuid(uuidA);
  let b = _findMeshByUuid(uuidB);
  if (!a || !b) {
    // Fall back to the most recent two entries of the selection set so
    // the op is usable from a manual UI click without having to look
    // uuids up by hand (matches slice 691 CSG behaviour).
    const sel = (typeof window !== 'undefined' &&
      Array.isArray(window.__studioSelectedMeshesSet))
      ? window.__studioSelectedMeshesSet.filter((m) => m && m.isMesh)
      : [];
    if (sel.length >= 2) {
      const last = sel.slice(-2);
      a = a || last[0];
      b = b || last[1];
    }
  }
  return { a, b };
}

function _resolveSingle(uuid) {
  let m = _findMeshByUuid(uuid);
  if (!m && typeof window !== 'undefined' && typeof window.__studioSelectedMesh === 'function') {
    try { m = window.__studioSelectedMesh() || null; } catch (_) { m = null; }
  }
  return m;
}

// Bake the world matrix of a mesh into a fresh geometry. Same shape the
// slice 691 CSG converter uses so the booleans treat operand position /
// rotation / scale correctly.
function _bakeGeometry(mesh) {
  mesh.updateMatrixWorld(true);
  const g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  return g;
}

function _placeResultInScene(geo, op) {
  const scene = (typeof window !== 'undefined') ? window.__archdiscScene : null;
  if (!scene) throw new Error('no scene');
  const material = new THREE.MeshStandardMaterial({
    color: 0xb8c4d0, roughness: 0.52, metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `booltol-${op}-result`;
  mesh.userData = mesh.userData || {};
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'booltol-result';
  mesh.userData.archdiscStudioBoolTolOp = op;
  scene.add(mesh);
  return mesh;
}

async function _runBoolean(op, opts) {
  const o = opts || {};
  const { a, b } = _resolvePair(o.meshAUuid, o.meshBUuid);
  if (!a || !b) {
    return { ok: false, error: 'tolerant boolean: need two mesh uuids (or two selected meshes)' };
  }
  if (a === b) {
    return { ok: false, error: 'tolerant boolean: operands must differ' };
  }
  const tol = (o.tol !== undefined) ? +o.tol : 1e-5;

  const geomA = _bakeGeometry(a);
  const geomB = _bakeGeometry(b);

  let runner;
  if (op === 'union')           runner = tolerantUnion;
  else if (op === 'difference') runner = tolerantDifference;
  else if (op === 'intersect')  runner = tolerantIntersection;
  else return { ok: false, error: `tolerant boolean: unknown op ${op}` };

  let res;
  try {
    res = await runner(geomA, geomB, tol);
  } catch (e) {
    try { geomA.dispose && geomA.dispose(); } catch (_) {}
    try { geomB.dispose && geomB.dispose(); } catch (_) {}
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
  try { geomA.dispose && geomA.dispose(); } catch (_) {}
  try { geomB.dispose && geomB.dispose(); } catch (_) {}

  if (!res || !res.ok || !res.geometry) {
    return { ok: false, error: (res && res.error) || 'tolerant boolean: no geometry' };
  }

  let mesh;
  try {
    mesh = _placeResultInScene(res.geometry, op);
  } catch (e) {
    try { res.geometry.dispose && res.geometry.dispose(); } catch (_) {}
    return { ok: false, error: e.message };
  }

  if (typeof window !== 'undefined' && typeof window.__studioPushUndo === 'function') {
    try { window.__studioPushUndo(`booltol-${op}`); } catch (_) {}
  }

  return {
    ok: true,
    op,
    uuid: mesh.uuid,
    verts: res.geometry.attributes.position.count,
    diagnostics: res.diagnostics || {},
  };
}

async function _runHeal(opts) {
  const o = opts || {};
  const m = _resolveSingle(o.meshUuid);
  if (!m || !m.geometry) return { ok: false, error: 'tolerant heal: no mesh' };
  const tol = (o.tol !== undefined) ? +o.tol : 1e-5;
  // The healer runs on a baked-world clone so a rotated mesh's heal is
  // accurate (welding tolerance applies in world space, not local).
  const geom = _bakeGeometry(m);
  let res;
  try {
    res = tolerantHeal(geom, tol);
  } catch (e) {
    try { geom.dispose && geom.dispose(); } catch (_) {}
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
  try { geom.dispose && geom.dispose(); } catch (_) {}
  if (!res || !res.ok || !res.geometry) {
    return { ok: false, error: (res && res.error) || 'tolerant heal: no geometry' };
  }
  // In-place replace the mesh's geometry — heal is a modifier, not a
  // new-mesh-spawn op (mirrors slice 786 qemdecim behaviour). Re-baking
  // the world matrix into local means we have to identity-zero the
  // transform so the healed geometry isn't double-transformed.
  if (typeof window !== 'undefined' && typeof window.__studioPushUndo === 'function') {
    try { window.__studioPushUndo('booltol-heal'); } catch (_) {}
  }
  const oldGeom = m.geometry;
  m.geometry = res.geometry;
  m.position.set(0, 0, 0);
  m.rotation.set(0, 0, 0);
  m.scale.set(1, 1, 1);
  m.updateMatrixWorld(true);
  try { oldGeom.dispose && oldGeom.dispose(); } catch (_) {}
  m.userData = m.userData || {};
  m.userData.archdiscStudioBoolTolHealed =
    (m.userData.archdiscStudioBoolTolHealed || 0) + 1;
  return {
    ok: true,
    op: 'heal',
    uuid: m.uuid,
    verts: res.geometry.attributes.position.count,
    diagnostics: res.diagnostics || {},
  };
}

export function installBoolTol() {
  if (typeof window === 'undefined') return { ok: false };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  const ops = {
    __studioBoolTolUnion: [
      (opts) => _runBoolean('union', opts),
      'Parasolid-tier tolerant boolean UNION with preheal + posthealed (meshAUuid, meshBUuid, tol?)',
    ],
    __studioBoolTolDifference: [
      (opts) => _runBoolean('difference', opts),
      'Parasolid-tier tolerant boolean DIFFERENCE with preheal + posthealed (meshAUuid, meshBUuid, tol?)',
    ],
    __studioBoolTolIntersection: [
      (opts) => _runBoolean('intersect', opts),
      'Parasolid-tier tolerant boolean INTERSECTION with preheal + posthealed (meshAUuid, meshBUuid, tol?)',
    ],
    __studioBoolTolHeal: [
      (opts) => _runHeal(opts),
      'Parasolid-tier tolerant mesh heal: weld + sliver-drop + small-hole fill + coplanar grouping (meshUuid, tol?)',
    ],
  };
  registerOps(ops, 'edit',
    'Parasolid-tier tolerant boolean healing — weld + sliver + hole-fill before CSG');

  return { ok: true, ops: 4 };
}

export default installBoolTol;
