// ArchDisc Studio V3 — volumetric FEM soft body (Houdini Vellum tetra)
// install path (slice 783).
//
// Closes the femsoft caveat documented in the slice-778-792 tier-1
// lift: PBD soft body (slices 757 / 767) treats every edge as a 1-D
// spring constraint, which folds at high deformation and can't
// represent volumetric incompressibility. This module ships a real
// **co-rotated linear-elastic FEM** solver on a **uniform-grid
// tetrahedralisation** of the source mesh's bbox, matching the
// Houdini Vellum / PhysX FEM topology that production studios use
// for jelly / muscle / fat / squash-and-stretch.
//
// Ops (all auto-registered under the `sim` palette category):
//
//   __studioFEMSoftCreate({meshUuid, opts}) → {ok, key, nodeCount, tetCount, surfaceBound?}
//     Tetrahedralise the named mesh's bbox, build a FEM state, and
//     bind the source mesh's surface vertices to the tet nodes via
//     barycentric coords. Subsequent `Step` calls will deform the
//     source mesh's BufferGeometry directly.
//
//     opts (all optional):
//       cellSize, gridRes, fillBBox  → tetrahedralize() opts
//       youngsModulus, poissonRatio  → material
//       density                      → mass per unit volume
//       gravity                      → [x,y,z] or {x,y,z}
//       damping                      → Verlet velocity damping
//       pinTopY                      → world Y threshold; nodes above
//                                     are auto-pinned (mass→∞).
//       pinIndices                   → explicit node indices to pin
//                                     at build time.
//
//   __studioFEMSoftStep({key, dt}) → {ok, energyResidual}
//   __studioFEMSoftPin({key, vertIdx}) → {ok}
//   __studioFEMSoftSetGravity({key, gravity}) → {ok}
//   __studioFEMSoftRemove({key}) → {ok}
//   __studioFEMSoftList() → {ok, items:[{key, nodeCount, tetCount, pinnedCount}]}
//
// Tagging: the source mesh gets `mesh.userData.archdiscStudioFEMSoft`
// stamped with metadata, mirroring the convention every other sim
// module uses so the simbake/outliner can detect it.

import * as THREE from 'three';
import { registerOps, unregisterOps } from '../common/registry.js';
import { tetrahedralize } from './tetrahedralize.js';
import {
  buildFEM,
  stepFEM,
  pinNode,
  setGravity,
  buildSurfaceBinding,
  applySurfaceBinding,
} from './femSolver.js';

let _installed = false;
// key (= meshUuid) → handle
const _bodies = new Map();

function _scene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function _findMeshByUuid(uuid) {
  const s = _scene();
  if (!s || !uuid) return null;
  let m = null;
  s.traverse((o) => { if (!m && o.uuid === uuid && o.isMesh) m = o; });
  return m;
}

// ─── Ops ────────────────────────────────────────────────────────────

function opFEMSoftCreate(args) {
  const a = args || {};
  const meshUuid = a.meshUuid;
  const opts = a.opts || {};
  if (!meshUuid) return { ok: false, error: 'no meshUuid' };
  const mesh = _findMeshByUuid(meshUuid);
  if (!mesh || !mesh.geometry) return { ok: false, error: 'no mesh by uuid' };

  // 1) Tetrahedralise.
  const tet = tetrahedralize(mesh, opts);
  if (!tet) return { ok: false, error: 'tetrahedralisation failed (degenerate bbox or no solid cells)' };

  // 2) Resolve auto-pin from pinTopY (in MESH-LOCAL space, since the
  //    tet nodes are in geometry-local coords by construction).
  let pinIndices = Array.isArray(opts.pinIndices) ? opts.pinIndices.slice() : [];
  if (Number.isFinite(+opts.pinTopY)) {
    const thr = +opts.pinTopY;
    for (let i = 0; i < tet.nodeCount; i++) {
      const y = tet.nodes[i * 3 + 1];
      if (y >= thr) pinIndices.push(i);
    }
  }

  // 3) Build FEM state.
  const state = buildFEM(tet, {
    youngsModulus: opts.youngsModulus,
    poissonRatio: opts.poissonRatio,
    density: opts.density,
    damping: opts.damping,
    gravity: opts.gravity,
    pinIndices,
  });
  if (!state) return { ok: false, error: 'buildFEM failed (no valid tets)' };

  // 4) Bind the source-mesh surface vertices to the tet mesh.
  let surfaceBinding = null;
  try {
    surfaceBinding = buildSurfaceBinding(mesh.geometry.attributes.position, state);
  } catch (_) {
    surfaceBinding = null;
  }

  const pinnedCount = pinIndices.length;
  _bodies.set(meshUuid, {
    key: meshUuid,
    mesh,
    state,
    tet,
    surfaceBinding,
    pinnedCount,
  });
  mesh.userData.archdiscStudioFEMSoft = {
    nodeCount: state.nodeCount,
    tetCount: state.tetCount,
    pinnedCount,
    youngsModulus: state.youngsModulus,
    poissonRatio: state.poissonRatio,
  };
  return {
    ok: true,
    key: meshUuid,
    nodeCount: state.nodeCount,
    tetCount: state.tetCount,
    surfaceBound: !!surfaceBinding,
    pinnedCount,
  };
}

function opFEMSoftStep(args) {
  const a = args || {};
  const handle = _bodies.get(a.key);
  if (!handle) return { ok: false, error: 'no FEM body by key' };
  const dt = Number.isFinite(+a.dt) ? +a.dt : (1 / 120);
  const r = stepFEM(handle.state, dt);
  // Push tet-node displacements back onto the source mesh's surface
  // verts using the cached barycentric binding.
  if (handle.surfaceBinding && handle.mesh && handle.mesh.geometry
      && handle.mesh.geometry.attributes && handle.mesh.geometry.attributes.position) {
    try {
      applySurfaceBinding(
        handle.surfaceBinding,
        handle.state,
        handle.mesh.geometry.attributes.position,
      );
      // Recompute normals so the lit viewport reflects the deformation.
      const geom = handle.mesh.geometry;
      if (typeof geom.computeVertexNormals === 'function') {
        geom.computeVertexNormals();
      }
    } catch (_) { /* swallow — keep solver running */ }
  }
  return { ok: true, energyResidual: r.energyResidual };
}

function opFEMSoftPin(args) {
  const a = args || {};
  const handle = _bodies.get(a.key);
  if (!handle) return { ok: false, error: 'no FEM body by key' };
  const r = pinNode(handle.state, a.vertIdx | 0);
  if (r.ok) {
    handle.pinnedCount++;
    if (handle.mesh && handle.mesh.userData && handle.mesh.userData.archdiscStudioFEMSoft) {
      handle.mesh.userData.archdiscStudioFEMSoft.pinnedCount = handle.pinnedCount;
    }
  }
  return r;
}

function opFEMSoftSetGravity(args) {
  const a = args || {};
  const handle = _bodies.get(a.key);
  if (!handle) return { ok: false, error: 'no FEM body by key' };
  return setGravity(handle.state, a.gravity);
}

function opFEMSoftRemove(args) {
  const a = args || {};
  const handle = _bodies.get(a.key);
  if (!handle) return { ok: false, error: 'no FEM body by key' };
  if (handle.mesh && handle.mesh.userData) {
    delete handle.mesh.userData.archdiscStudioFEMSoft;
  }
  _bodies.delete(a.key);
  return { ok: true };
}

function opFEMSoftList() {
  const items = [];
  for (const h of _bodies.values()) {
    items.push({
      key: h.key,
      nodeCount: h.state.nodeCount,
      tetCount: h.state.tetCount,
      pinnedCount: h.pinnedCount,
    });
  }
  return { ok: true, items };
}

// ─── Install / uninstall ───────────────────────────────────────────

const OP_NAMES = [
  '__studioFEMSoftCreate',
  '__studioFEMSoftStep',
  '__studioFEMSoftPin',
  '__studioFEMSoftSetGravity',
  '__studioFEMSoftRemove',
  '__studioFEMSoftList',
];

export function installFEMSoft() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioFEMSoftInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioFEMSoftInstalled = true;
  const ops = {
    __studioFEMSoftCreate: [
      (args) => opFEMSoftCreate(args),
      'Build a volumetric FEM soft body from a mesh '
        + '(Houdini Vellum tetra: uniform-grid tetrahedralisation + '
        + 'co-rotated linear elasticity). args:{meshUuid, opts:{'
        + 'gridRes, cellSize, fillBBox, youngsModulus, poissonRatio, '
        + 'density, gravity, damping, pinTopY, pinIndices}}',
    ],
    __studioFEMSoftStep: [
      (args) => opFEMSoftStep(args),
      'Advance the FEM body by dt seconds (Verlet, single substep).',
    ],
    __studioFEMSoftPin: [
      (args) => opFEMSoftPin(args),
      'Pin a tetrahedral node by index (mass→∞).',
    ],
    __studioFEMSoftSetGravity: [
      (args) => opFEMSoftSetGravity(args),
      'Replace the body-force gravity vector.',
    ],
    __studioFEMSoftRemove: [
      (args) => opFEMSoftRemove(args),
      'Drop a FEM body handle (source mesh stays).',
    ],
    __studioFEMSoftList: [
      () => opFEMSoftList(),
      'List every active FEM soft body in the scene.',
    ],
  };
  registerOps(ops, 'sim',
    'Houdini Vellum-tier volumetric FEM soft body '
    + '(tetrahedral mesh + co-rotated linear elasticity, slice 783).');
  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallFEMSoft() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  for (const h of _bodies.values()) {
    if (h.mesh && h.mesh.userData) {
      delete h.mesh.userData.archdiscStudioFEMSoft;
    }
  }
  _bodies.clear();
  unregisterOps(OP_NAMES);
  _installed = false;
  window.__studioFEMSoftInstalled = false;
  return { ok: true };
}

// Internal handle map for tests / debugging.
export const __internal = { _bodies };

// THREE referenced in jsdoc; keep the import live to satisfy strict lint.
export const __THREE_HANDLE = THREE;

export default installFEMSoft;
