// ArchDisc Studio V3 — Marvelous Designer multi-layer garment stack
// (slice 780). Op surface.
//
// `installClothLayer()` wires `window.__studioClothLayer*` ops backed by
// `multiLayer.js`. The op surface is intentionally small (4 verbs) so
// downstream gestures (the garment workbench, the Marvelous Designer
// patterning tool, agent calls) can drive it cleanly:
//
//   __studioClothLayerCreate({ meshes, opts })  → { ok, key, layerCount }
//   __studioClothLayerSew({ key, seam: [loopA, loopB] }) → { ok, seamIdx, pairCount }
//   __studioClothLayerStep({ key, dt, iterations }) → { ok, ... }
//   __studioClothLayerEnableSelfCollision({ key, enable }) → { ok, layerCount, enabled }
//
// Bonus diagnostic ops (not in the brief but the pattern in every other
// V3 module) — these are read-only and let tests / sidebars introspect:
//
//   __studioClothLayerList() → { ok, items:[{key, layerCount, seamCount, elapsed}] }
//   __studioClothLayerReport({ key }) → { ok, ... reportStack output ... }
//   __studioClothLayerRemove({ key }) → { ok }
//
// All ops register under category `sim`.

import { registerOps, unregisterOps } from '../common/registry.js';
import {
  buildClothStack, stepClothStack, addStackSeam,
  setStackSelfCollision, reportStack,
} from './multiLayer.js';

let _installed = false;
// key → stack
const _stacks = new Map();
let _seq = 1;
function _genKey() { return `cloth-layer-${_seq++}-${Date.now().toString(36)}`; }

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
  s.traverse((o) => { if (!m && o.uuid === uuid) m = o; });
  return m;
}

/**
 * Resolve the `meshes` field. Accepts either:
 *   • [uuidA, uuidB, ...]
 *   • [{ uuid, layer?, clothOpts?, selfCollision? }, ...]
 *   • [{ mesh, layer?, ... }, ...]  (direct mesh refs)
 *
 * @returns {Array<{mesh, layer?, clothOpts?, selfCollision?}>|null}
 */
function _normalizeMeshes(meshes) {
  if (!Array.isArray(meshes) || meshes.length === 0) return null;
  const out = [];
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    if (!m) return null;
    if (typeof m === 'string') {
      const mesh = _findMeshByUuid(m);
      if (!mesh) return null;
      out.push({ mesh });
    } else if (m.mesh && m.mesh.geometry) {
      out.push({
        mesh: m.mesh,
        layer: m.layer,
        clothOpts: m.clothOpts,
        selfCollision: m.selfCollision,
      });
    } else if (m.uuid) {
      const mesh = _findMeshByUuid(m.uuid);
      if (!mesh) return null;
      out.push({
        mesh,
        layer: m.layer,
        clothOpts: m.clothOpts,
        selfCollision: m.selfCollision,
      });
    } else {
      return null;
    }
  }
  return out;
}

// ─── Ops ───────────────────────────────────────────────────────────────

function opCreate(args) {
  const a = args || {};
  const layers = _normalizeMeshes(a.meshes);
  if (!layers) return { ok: false, error: 'invalid-meshes' };
  const stack = buildClothStack({
    layers,
    selfCollisionOpts: a.opts && a.opts.selfCollision ? a.opts.selfCollision : {},
    sewingOpts: a.opts && a.opts.sewing ? a.opts.sewing : {},
    crossLayerCollision: a.opts && a.opts.crossLayerCollision !== undefined
      ? !!a.opts.crossLayerCollision
      : true,
  });
  if (!stack) return { ok: false, error: 'failed-to-build-stack' };
  const key = _genKey();
  _stacks.set(key, stack);
  // Tag each mesh so the outliner can show it's part of a layered stack.
  for (let i = 0; i < stack.layers.length; i++) {
    const l = stack.layers[i];
    if (l.mesh && l.mesh.userData) {
      l.mesh.userData.archdiscStudioClothLayer = {
        stackKey: key,
        layer: l.layer,
        vertCount: l.cloth.vertCount,
      };
    }
  }
  return {
    ok: true,
    key,
    layerCount: stack.layers.length,
    layers: stack.layers.map((l) => ({
      id: l.id,
      layer: l.layer,
      vertCount: l.cloth.vertCount,
    })),
  };
}

function opSew(args) {
  const a = args || {};
  const stack = _stacks.get(a.key);
  if (!stack) return { ok: false, error: 'no-stack-by-key' };
  if (!Array.isArray(a.seam) || a.seam.length !== 2) {
    return { ok: false, error: 'seam-must-be-pair' };
  }
  return addStackSeam(stack, a.seam[0], a.seam[1], a.opts || {});
}

function opStep(args) {
  const a = args || {};
  const stack = _stacks.get(a.key);
  if (!stack) return { ok: false, error: 'no-stack-by-key' };
  const dt = Number.isFinite(+a.dt) ? +a.dt : (1 / 60);
  const iters = Math.max(1, Math.floor(+a.iterations) || 6);
  return stepClothStack(stack, dt, iters);
}

function opEnableSelfCollision(args) {
  const a = args || {};
  const stack = _stacks.get(a.key);
  if (!stack) return { ok: false, error: 'no-stack-by-key' };
  return setStackSelfCollision(stack, !!a.enable);
}

function opList() {
  const items = [];
  for (const [key, stack] of _stacks) {
    items.push({
      key,
      layerCount: stack.layers.length,
      seamCount: stack.sew.seams.length,
      elapsed: stack.elapsed,
    });
  }
  return { ok: true, items };
}

function opReport(args) {
  const a = args || {};
  const stack = _stacks.get(a.key);
  if (!stack) return { ok: false, error: 'no-stack-by-key' };
  return reportStack(stack);
}

function opRemove(args) {
  const a = args || {};
  const stack = _stacks.get(a.key);
  if (!stack) return { ok: false, error: 'no-stack-by-key' };
  for (let i = 0; i < stack.layers.length; i++) {
    const l = stack.layers[i];
    if (l.mesh && l.mesh.userData) {
      delete l.mesh.userData.archdiscStudioClothLayer;
    }
  }
  _stacks.delete(a.key);
  return { ok: true };
}

// ─── Install / uninstall ───────────────────────────────────────────────

const OP_NAMES = [
  '__studioClothLayerCreate',
  '__studioClothLayerSew',
  '__studioClothLayerStep',
  '__studioClothLayerEnableSelfCollision',
  '__studioClothLayerList',
  '__studioClothLayerReport',
  '__studioClothLayerRemove',
];

export function installClothLayer() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioClothLayerInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioClothLayerInstalled = true;
  const ops = {
    __studioClothLayerCreate: [opCreate,
      'Build a multi-layer Marvelous-Designer-style cloth stack (skin → undershirt → shirt → ...).'],
    __studioClothLayerSew: [opSew,
      'Sew a vertex loop on cloth A to a vertex loop on cloth B with bidirectional PBD seams.'],
    __studioClothLayerStep: [opStep,
      'Step every cloth + self-collision + cross-layer collision + sewing relaxation.'],
    __studioClothLayerEnableSelfCollision: [opEnableSelfCollision,
      'Toggle the per-particle self-collision pass on every layer in the stack.'],
    __studioClothLayerList: [opList,
      'List every active cloth-layer stack.'],
    __studioClothLayerReport: [opReport,
      'Diagnostic snapshot: layer + seam + gap stats for one stack.'],
    __studioClothLayerRemove: [opRemove,
      'Tear down a cloth-layer stack (the meshes themselves stay).'],
  };
  registerOps(ops, 'sim',
    'Marvelous Designer multi-layer garment stack — self-collision + cross-layer + sewing seams (slice 780).');
  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallClothLayer() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  for (const stack of _stacks.values()) {
    for (let i = 0; i < stack.layers.length; i++) {
      const l = stack.layers[i];
      if (l.mesh && l.mesh.userData) {
        delete l.mesh.userData.archdiscStudioClothLayer;
      }
    }
  }
  _stacks.clear();
  unregisterOps(OP_NAMES);
  _installed = false;
  window.__studioClothLayerInstalled = false;
  return { ok: true };
}

export const __internal = { _stacks };

export default installClothLayer;
