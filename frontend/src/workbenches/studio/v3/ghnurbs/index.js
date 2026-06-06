// Slice 759 — Rhino Grasshopper-specific NURBS node palette installer.
//
// Wires the seven Rhino-flavour NURBS nodes (curve / surface / extrude /
// loft / revolve / trim / offset) into Studio's window.__studio* op
// surface and the V3 command palette under category 'edit'. Mirrors the
// v3/ghgraph/ installer pattern but exposes *direct constructor ops*
// (not graph wires) so an Archie tool-call can spawn a NURBS primitive
// in a single round-trip — the way a Grasshopper user would drag a
// component into the canvas and immediately see geometry.
//
// Op surface:
//   __studioGHNurbsCreateCurve(controlPoints, degree)
//     → { ok, uuid, kind:'nurbsCurve' }
//   __studioGHNurbsCreateSurface(controlNet, degreeU, degreeV)
//     → { ok, uuid, kind:'nurbsSurface' }
//   __studioGHNurbsExtrude(curveUuid, dir, distance)
//     → { ok, uuid, kind:'nurbsExtrude' }
//   __studioGHNurbsLoft(curveAUuid, curveBUuid, samples)
//     → { ok, uuid, kind:'nurbsLoft' }
//   __studioGHNurbsRevolve(curveUuid, axis, angle)
//     → { ok, uuid, kind:'nurbsRevolve' }
//   __studioGHNurbsTrim(surfaceUuid, boundary, keepInside)
//     → { ok, uuid, kind:'nurbsTrim' }
//   __studioGHNurbsOffset(curveUuid, distance)
//     → { ok, uuid, kind:'nurbsOffset' }
//   __studioGHNurbsListNodeKinds() → { ok, kinds:[...] }
//
// Each create-op evaluates the corresponding node factory, parents the
// returned THREE.Mesh into window.__archdiscScene, and returns the new
// mesh uuid so chained ops (extrude→loft→revolve) can reference it.
// The control-point arrays themselves are kept on
// userData.archdiscStudioGHNurbsParams so downstream ops can re-fetch
// the curve definition by uuid.

import { registerOps } from '../common/registry.js';
import {
  makeNode,
  NURBS_NODE_KINDS,
} from './nurbsNodes.js';

let _installed = false;

function _scene() {
  return (typeof window !== 'undefined') ? window.__archdiscScene : null;
}

function _addToScene(mesh) {
  const scene = _scene();
  if (!scene || !mesh) return false;
  scene.add(mesh);
  if (typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(mesh); } catch (_) { /* swallow */ }
  }
  return true;
}

function _findMesh(uuid) {
  const scene = _scene();
  if (!scene || !uuid) return null;
  let hit = null;
  scene.traverse((o) => { if (!hit && o.uuid === uuid) hit = o; });
  return hit;
}

// Extract the originating NURBS control-point set off a mesh's userData.
// Falls back to null when the mesh isn't one of ours.
function _curveOf(uuid) {
  const m = _findMesh(uuid);
  if (!m) return null;
  const p = m.userData?.archdiscStudioGHNurbsParams;
  if (!p) return null;
  // curve nodes have `controlPoints`; surface nodes have `controlNet`.
  if (Array.isArray(p.controlPoints)) return p.controlPoints;
  return null;
}

function _surfaceOf(uuid) {
  const m = _findMesh(uuid);
  if (!m) return null;
  const p = m.userData?.archdiscStudioGHNurbsParams;
  if (!p) return null;
  if (Array.isArray(p.controlNet)) return p.controlNet;
  return null;
}

// ─── Op implementations ──────────────────────────────────────────────

function createCurve(controlPoints, degree) {
  if (!Array.isArray(controlPoints) || controlPoints.length < 2) {
    return { ok: false, error: 'controlPoints[] of length ≥2 required' };
  }
  const node = makeNode('nurbsCurve', { controlPoints, degree });
  const mesh = node.evaluate({});
  if (!mesh) return { ok: false, error: 'curve eval failed' };
  if (!_addToScene(mesh)) return { ok: false, error: 'no scene' };
  return { ok: true, uuid: mesh.uuid, kind: 'nurbsCurve' };
}

function createSurface(controlNet, degreeU, degreeV) {
  if (!Array.isArray(controlNet) || controlNet.length < 2 || !Array.isArray(controlNet[0]) || controlNet[0].length < 2) {
    return { ok: false, error: 'controlNet must be ≥2×2 grid' };
  }
  const node = makeNode('nurbsSurface', { controlNet, degreeU, degreeV });
  const mesh = node.evaluate({});
  if (!mesh) return { ok: false, error: 'surface eval failed' };
  if (!_addToScene(mesh)) return { ok: false, error: 'no scene' };
  return { ok: true, uuid: mesh.uuid, kind: 'nurbsSurface' };
}

function extrudeCurve(curveUuid, dir, distance) {
  const cps = _curveOf(curveUuid);
  if (!cps) return { ok: false, error: 'curve uuid not found or not a NURBS curve' };
  const dirA = Array.isArray(dir) ? dir : [0, 1, 0];
  const dist = Number.isFinite(distance) ? distance : 1;
  const node = makeNode('nurbsExtrude', { controlPoints: cps, dir: dirA, distance: dist });
  const mesh = node.evaluate({});
  if (!mesh) return { ok: false, error: 'extrude eval failed' };
  if (!_addToScene(mesh)) return { ok: false, error: 'no scene' };
  return { ok: true, uuid: mesh.uuid, kind: 'nurbsExtrude' };
}

function loftCurves(curveAUuid, curveBUuid, samples) {
  const a = _curveOf(curveAUuid);
  const b = _curveOf(curveBUuid);
  if (!a) return { ok: false, error: 'curveA uuid not found' };
  if (!b) return { ok: false, error: 'curveB uuid not found' };
  const s = Number.isFinite(samples) ? samples : 24;
  const node = makeNode('nurbsLoft', { curveA: a, curveB: b, samples: s });
  const mesh = node.evaluate({});
  if (!mesh) return { ok: false, error: 'loft eval failed' };
  if (!_addToScene(mesh)) return { ok: false, error: 'no scene' };
  return { ok: true, uuid: mesh.uuid, kind: 'nurbsLoft' };
}

function revolveCurve(curveUuid, axis, angle) {
  const cps = _curveOf(curveUuid);
  if (!cps) return { ok: false, error: 'curve uuid not found' };
  const ax = Array.isArray(axis) ? axis : [0, 1, 0];
  const ang = Number.isFinite(angle) ? angle : Math.PI * 2;
  const node = makeNode('nurbsRevolve', { controlPoints: cps, axis: ax, angle: ang });
  const mesh = node.evaluate({});
  if (!mesh) return { ok: false, error: 'revolve eval failed' };
  if (!_addToScene(mesh)) return { ok: false, error: 'no scene' };
  return { ok: true, uuid: mesh.uuid, kind: 'nurbsRevolve' };
}

function trimSurface(surfaceUuid, boundary, keepInside) {
  const grid = _surfaceOf(surfaceUuid);
  if (!grid) return { ok: false, error: 'surface uuid not found' };
  if (!Array.isArray(boundary) || boundary.length < 3) {
    return { ok: false, error: 'boundary must be ≥3 [u,v] points' };
  }
  const node = makeNode('nurbsTrim', { controlNet: grid, boundary, keepInside: keepInside !== false });
  const mesh = node.evaluate({});
  if (!mesh) return { ok: false, error: 'trim eval failed' };
  if (!_addToScene(mesh)) return { ok: false, error: 'no scene' };
  return { ok: true, uuid: mesh.uuid, kind: 'nurbsTrim' };
}

function offsetCurve(curveUuid, distance) {
  const cps = _curveOf(curveUuid);
  if (!cps) return { ok: false, error: 'curve uuid not found' };
  const dist = Number.isFinite(distance) ? distance : 0.25;
  const node = makeNode('nurbsOffset', { controlPoints: cps, distance: dist });
  const mesh = node.evaluate({});
  if (!mesh) return { ok: false, error: 'offset eval failed' };
  if (!_addToScene(mesh)) return { ok: false, error: 'no scene' };
  return { ok: true, uuid: mesh.uuid, kind: 'nurbsOffset' };
}

function listNodeKinds() {
  return { ok: true, kinds: NURBS_NODE_KINDS.slice() };
}

// ─── Installer ───────────────────────────────────────────────────────

export function installGHNurbs() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioGHNurbsCreateCurve: createCurve,
    __studioGHNurbsCreateSurface: createSurface,
    __studioGHNurbsExtrude: extrudeCurve,
    __studioGHNurbsLoft: loftCurves,
    __studioGHNurbsRevolve: revolveCurve,
    __studioGHNurbsTrim: trimSurface,
    __studioGHNurbsOffset: offsetCurve,
    __studioGHNurbsListNodeKinds: listNodeKinds,
  };
  for (const [name, fn] of Object.entries(ops)) {
    if (typeof window !== 'undefined') window[name] = fn;
  }
  registerOps(
    ops,
    'edit',
    'Rhino Grasshopper-specific NURBS node palette (curve / surface / extrude / loft / revolve / trim / offset)',
  );
}

export default installGHNurbs;
