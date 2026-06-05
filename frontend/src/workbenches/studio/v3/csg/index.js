// ArchDisc Studio V3 — Real-CSG installer.
//
// installCSG() is idempotent. It attaches the window.__studioCSG* op
// surface and registers each op with the V3 command palette under
// category 'csg'. The actual maths lives in ./csg.js.
//
// Op surface (matches the slice contract):
//   __studioCSGUnion(uuidA, uuidB)        → { ok, uuid, verts, op:'union' }
//   __studioCSGDifference(uuidA, uuidB)   → { ok, uuid, verts, op:'difference' }
//   __studioCSGIntersect(uuidA, uuidB)    → { ok, uuid, verts, op:'intersect' }
//   __studioCSGReady()                     → { ok, error? }
//   __studioCSGListAvailable()             → { ok, count, meshes:[{uuid,name,kind}] }
//
// All ops add a NEW mesh to window.__archdiscScene tagged
//   userData.archdiscStudioPrimitive       = true
//   userData.archdiscStudioPrimitiveKind   = 'csg-result'
//   userData.archdiscStudioCsgOp           = '<union|difference|intersect>'
// and leave the two input meshes in place untouched. This is the
// difference from the slice-579 __studioBoolean wrapper, which removes
// the inputs — here the inputs are preserved per the slice contract.

import * as THREE from 'three';
import { csgBoolean, isReady } from './csg.js';

let _installed = false;

// ─── Selection helpers ─────────────────────────────────────────────────
function findMeshByUuid(uuid) {
  const scene = (typeof window !== 'undefined') ? window.__archdiscScene : null;
  if (!scene || !uuid) return null;
  let hit = null;
  scene.traverse((o) => {
    if (!hit && o.uuid === uuid && o.isMesh) hit = o;
  });
  return hit;
}

/**
 * Resolve a (uuidA, uuidB) pair into two THREE.Mesh handles. If either
 * uuid is missing or null, fall back to the most recent two entries of
 * window.__studioSelectedMeshesSet so the op is usable from a manual
 * UI click without having to look uuids up by hand.
 */
function resolvePair(uuidA, uuidB) {
  let a = findMeshByUuid(uuidA);
  let b = findMeshByUuid(uuidB);
  if (!a || !b) {
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
  // If only one selected mesh + a `__studioSelectedMesh` plus an explicit
  // uuid, allow that combination too.
  if (!a && typeof window !== 'undefined' && typeof window.__studioSelectedMesh === 'function') {
    const s = window.__studioSelectedMesh();
    if (s && s.isMesh) a = s;
  }
  return { a, b };
}

// ─── Result placement ──────────────────────────────────────────────────
function placeResultInScene(geo, op) {
  const scene = (typeof window !== 'undefined') ? window.__archdiscScene : null;
  if (!scene) throw new Error('no scene');
  const material = new THREE.MeshStandardMaterial({
    color: 0xbac4ce, roughness: 0.55, metalness: 0.08,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `csg-${op}-result`;
  mesh.userData = mesh.userData || {};
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'csg-result';
  mesh.userData.archdiscStudioCsgOp = op;
  scene.add(mesh);
  return mesh;
}

// ─── Op wrappers ───────────────────────────────────────────────────────
async function runOp(op, uuidA, uuidB) {
  const { a, b } = resolvePair(uuidA, uuidB);
  if (!a || !b) return { ok: false, error: 'need two mesh uuids (or two selected meshes)' };
  if (a === b) return { ok: false, error: 'operands must differ' };
  let geo;
  try {
    geo = await csgBoolean(op, a, b);
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
  if (!geo || !geo.attributes || !geo.attributes.position ||
      geo.attributes.position.count === 0) {
    return { ok: false, error: 'result geometry empty' };
  }
  const verts = geo.attributes.position.count;
  let mesh;
  try {
    mesh = placeResultInScene(geo, op);
  } catch (e) {
    geo.dispose();
    return { ok: false, error: e.message };
  }
  if (typeof window !== 'undefined' && typeof window.__studioPushUndo === 'function') {
    try { window.__studioPushUndo(`csg-${op}`); } catch (_) { /* swallow */ }
  }
  return { ok: true, op, uuid: mesh.uuid, verts };
}

// ─── Listing helper ────────────────────────────────────────────────────
function listAvailable() {
  const scene = (typeof window !== 'undefined') ? window.__archdiscScene : null;
  if (!scene) return { ok: false, count: 0, meshes: [] };
  const out = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.userData || !o.userData.archdiscStudioPrimitive) return;
    out.push({
      uuid: o.uuid,
      name: o.name || '',
      kind: o.userData.archdiscStudioPrimitiveKind || 'unknown',
    });
  });
  return { ok: true, count: out.length, meshes: out };
}

// ─── Install / uninstall ───────────────────────────────────────────────
export function installCSG() {
  if (typeof window === 'undefined') return { ok: false };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  window.__studioCSGUnion       = (a, b) => runOp('union',      a, b);
  window.__studioCSGDifference  = (a, b) => runOp('difference', a, b);
  window.__studioCSGIntersect   = (a, b) => runOp('intersect',  a, b);
  window.__studioCSGReady       = () => isReady();
  window.__studioCSGListAvailable = () => listAvailable();

  // Command-palette registration. We schedule this on a microtask so
  // the registration lands even if installCSG() somehow runs ahead of
  // registerV3Api() — which is the case when the e2e spec installs the
  // module via the dev-server URL before api.js has finished its own
  // bootstrap.
  const register = () => {
    const reg = window.__studioCommandRegister;
    if (typeof reg !== 'function') return false;
    const cat = 'csg';
    const cmds = [
      ['__studioCSGUnion',         'CSG union of two meshes (uuidA, uuidB) → new watertight mesh'],
      ['__studioCSGDifference',    'CSG difference A − B (uuidA, uuidB) → new watertight mesh'],
      ['__studioCSGIntersect',     'CSG intersection of two meshes (uuidA, uuidB) → new watertight mesh'],
      ['__studioCSGReady',         'Probe manifold-3d WASM readiness'],
      ['__studioCSGListAvailable', 'List Studio primitive meshes available for CSG (uuid, name, kind)'],
    ];
    for (const [name, desc] of cmds) {
      reg(name, window[name], { category: cat, description: desc });
    }
    return true;
  };
  if (!register()) {
    // Defer up to a few hundred ms — the orchestrator imports autoloads
    // immediately after registerV3Api, so this rarely loops more than
    // once.
    let tries = 0;
    const id = setInterval(() => {
      tries++;
      if (register() || tries > 40) clearInterval(id);
    }, 25);
  }

  return { ok: true, ops: 5 };
}

export function uninstallCSG() {
  if (!_installed) return { ok: true };
  _installed = false;
  for (const k of [
    '__studioCSGUnion', '__studioCSGDifference', '__studioCSGIntersect',
    '__studioCSGReady', '__studioCSGListAvailable',
  ]) {
    try { delete window[k]; } catch (_) { /* ignore */ }
  }
  return { ok: true };
}
