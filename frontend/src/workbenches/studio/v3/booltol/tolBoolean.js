// ArchDisc Studio V3 — Parasolid-tier tolerant boolean wrapper
// (slice 781).
//
// `tolerantUnion`, `tolerantDifference`, `tolerantIntersection`:
//
//   1. PREHEAL both inputs (weld → drop slivers → fill small holes →
//      record coplanar groups).
//   2. Run the real polygonal CSG via the slice-691 csg.js (manifold-3d).
//   3. POSTHEAL the result with a final weld at the same tolerance so
//      coincident-face seams don't leave hairline cracks.
//
// Each return value is { ok, geometry, diagnostics } where
//   diagnostics = { aPreheal, bPreheal, postPreheal, op }
//
// This module deliberately does NOT touch the scene. Scene-side wiring
// lives in ./index.js — pure functions go here so tests can drive them
// without a window.
//
// Fallback: if the manifold-3d module fails to load (very rare —
// captured via csg.ensureManifoldModule's error path), we fall back to a
// best-effort merge of the two pre-healed geometries via mergeGeometries
// (BufferGeometryUtils). This is NOT a real boolean — it's the
// "Parasolid couldn't classify, return the union of inputs" behaviour
// imported CAD users see when their geometry is too broken to operate
// on. The diagnostics field records `fallback: true` so callers can
// surface that.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { csgBoolean, ensureManifoldModule, threeMeshToManifoldMesh, manifoldToThreeGeometry } from '../csg/csg.js';
import { prehealGeometry, removeDuplicateVerts } from './preheal.js';

// Pack a BufferGeometry behind a minimal "fake mesh" so we can reuse
// csg.js's threeMeshToManifoldMesh which expects a THREE.Mesh with a
// matrixWorld. We bake an identity matrix so the geometry is taken at
// face value (the prehealer + scene caller have already applied any
// transforms).
function geomAsMesh(geom) {
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geom, mat);
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorld.identity();
  return mesh;
}

// Direct geometry-level boolean (no scene transforms) — bypasses
// csgBoolean which expects THREE.Mesh handles + bakes matrixWorld.
async function _booleanOnGeoms(kind, geomA, geomB) {
  const m = await ensureManifoldModule();
  const Manifold = m.Manifold;
  const Mesh = m.Mesh;
  const mA = geomAsMesh(geomA);
  const mB = geomAsMesh(geomB);
  const meshA = new Mesh(threeMeshToManifoldMesh(mA));
  const meshB = new Mesh(threeMeshToManifoldMesh(mB));
  let manA = null, manB = null, result = null;
  try {
    manA = new Manifold(meshA);
    manB = new Manifold(meshB);
    if (kind === 'union')           result = manA.add(manB);
    else if (kind === 'difference') result = manA.subtract(manB);
    else if (kind === 'intersect')  result = manA.intersect(manB);
    else throw new Error(`tolerantBoolean: unknown op ${kind}`);
    return manifoldToThreeGeometry(result);
  } finally {
    try { if (result && result.delete) result.delete(); } catch (_) {}
    try { if (manA && manA.delete) manA.delete(); } catch (_) {}
    try { if (manB && manB.delete) manB.delete(); } catch (_) {}
    try { if (meshA && meshA.delete) meshA.delete(); } catch (_) {}
    try { if (meshB && meshB.delete) meshB.delete(); } catch (_) {}
  }
}

// Best-effort fallback when manifold-3d fails to load. Used by the
// fallback paths below.
function _fallbackMergeGeoms(geomA, geomB) {
  const merged = mergeGeometries([geomA, geomB], false);
  if (!merged) return null;
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

// Public entry point — runs the full Parasolid-tier tolerant pipeline.
async function _runTolerantBoolean(kind, geomA, geomB, tol) {
  if (!geomA || !geomB) {
    return { ok: false, error: 'tolerantBoolean: need two geometries' };
  }
  const eps = (typeof tol === 'number' && isFinite(tol) && tol > 0) ? tol : 1e-5;

  // PREHEAL both inputs.
  let healedA, healedB;
  try {
    healedA = prehealGeometry(geomA, {
      tol: eps,
      sliverRatio: 1e-6,
      holeArea: eps * 1e4, // ~1e-1 of nominal scene scale at default tol
      cosThreshold: 0.99996,
      offsetThreshold: eps * 10,
    });
    healedB = prehealGeometry(geomB, {
      tol: eps,
      sliverRatio: 1e-6,
      holeArea: eps * 1e4,
      cosThreshold: 0.99996,
      offsetThreshold: eps * 10,
    });
  } catch (e) {
    return {
      ok: false,
      error: 'tolerantBoolean: preheal failed: ' + (e && e.message ? e.message : String(e)),
    };
  }
  const aDiag = (healedA.userData && healedA.userData.archdiscStudioPreheal) || {};
  const bDiag = (healedB.userData && healedB.userData.archdiscStudioPreheal) || {};

  // CSG.
  let result = null;
  let fallback = false;
  try {
    result = await _booleanOnGeoms(kind, healedA, healedB);
  } catch (e) {
    // manifold-3d failed — fall back to best-effort merge for union, or
    // give up for difference/intersect (no sensible polygonal fallback).
    if (kind === 'union') {
      result = _fallbackMergeGeoms(healedA, healedB);
      fallback = true;
    } else {
      try { healedA.dispose && healedA.dispose(); } catch (_) {}
      try { healedB.dispose && healedB.dispose(); } catch (_) {}
      return {
        ok: false,
        error: 'tolerantBoolean: CSG failed: ' + (e && e.message ? e.message : String(e)),
      };
    }
  }
  try { healedA.dispose && healedA.dispose(); } catch (_) {}
  try { healedB.dispose && healedB.dispose(); } catch (_) {}

  if (!result || !result.attributes || !result.attributes.position ||
      result.attributes.position.count === 0) {
    return { ok: false, error: 'tolerantBoolean: result empty' };
  }

  // POSTHEAL — final weld so coincident-face seams don't leave cracks.
  // Slivers + holes are NOT re-run here: the manifold-3d output is
  // watertight by construction; we only weld near-duplicate verts that
  // the CSG split may have introduced from the input tolerance.
  let postHealed;
  try {
    postHealed = removeDuplicateVerts(result, eps);
  } catch (e) {
    postHealed = result;
  }
  if (postHealed !== result) {
    try { result.dispose && result.dispose(); } catch (_) {}
  }
  const postDiag = (postHealed.userData && postHealed.userData.archdiscStudioPreheal) || {};

  return {
    ok: true,
    geometry: postHealed,
    diagnostics: {
      op: kind,
      tol: eps,
      fallback,
      aPreheal: aDiag,
      bPreheal: bDiag,
      postPreheal: postDiag,
    },
  };
}

export function tolerantUnion(geomA, geomB, tol) {
  return _runTolerantBoolean('union', geomA, geomB, tol);
}
export function tolerantDifference(geomA, geomB, tol) {
  return _runTolerantBoolean('difference', geomA, geomB, tol);
}
export function tolerantIntersection(geomA, geomB, tol) {
  return _runTolerantBoolean('intersect', geomA, geomB, tol);
}

// Standalone heal that just runs the preheal chain on a single geometry
// and returns it. Surfaces the diagnostics in userData for the op
// callers (which strip it and return to the caller).
export function tolerantHeal(geom, tol) {
  if (!geom) return { ok: false, error: 'tolerantHeal: no geometry' };
  const eps = (typeof tol === 'number' && isFinite(tol) && tol > 0) ? tol : 1e-5;
  try {
    const healed = prehealGeometry(geom, {
      tol: eps,
      sliverRatio: 1e-6,
      holeArea: eps * 1e4,
      cosThreshold: 0.99996,
      offsetThreshold: eps * 10,
    });
    return {
      ok: true,
      geometry: healed,
      diagnostics: (healed.userData && healed.userData.archdiscStudioPreheal) || {},
    };
  } catch (e) {
    return { ok: false, error: 'tolerantHeal: ' + (e && e.message ? e.message : String(e)) };
  }
}
