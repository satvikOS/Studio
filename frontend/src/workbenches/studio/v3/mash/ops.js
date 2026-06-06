// Slice 753 — Maya MASH arrange ops surface.
//
// New uppercase __studioMASH* ops layered on top of the slice-699
// network engine. The legacy lowercase __studioMashDistribute (defined
// in WorkbenchStudio.jsx / mographops.js) is untouched.

import { registerOps } from '../common/registry.js';
import {
  linearMatrices, gridMatrices, radialMatrices,
  spiralMatrices, fibonacciMatrices,
} from './distribute.js';
import {
  replicateInstanced, applyEffectorStack, removeHandle,
  listHandles, tagMode, getHandles,
} from './arrange.js';

// Pure dispatcher: distribute-mode string → Matrix4[]. Pulled out so the
// ops layer is mode-agnostic and so tests can call into it directly.
function _matricesFor(mode, count, params) {
  const p = params || {};
  switch (mode) {
    case 'linear':
      return linearMatrices(count, p.start || [0, 0, 0], p.spacing || [1, 0, 0]);
    case 'grid': {
      const nx = (p.nx === undefined) ? 1 : (p.nx | 0);
      const ny = (p.ny === undefined) ? 1 : (p.ny | 0);
      const nz = (p.nz === undefined) ? 1 : (p.nz | 0);
      return gridMatrices(nx, ny, nz, p.spacing || [1, 1, 1]);
    }
    case 'radial':
      return radialMatrices(count, p.radius || 1);
    case 'spiral':
      return spiralMatrices(
        count,
        p.r0 || 0,
        p.rStep || 0,
        (p.angleStep === undefined) ? 0.3 : p.angleStep,
        p.hStep || 0,
      );
    case 'fibonacci':
      return fibonacciMatrices(count, p.R || p.radius || 1);
    default:
      return [];
  }
}

// __studioMASHDistribute — build the matrices, replicate, return the
// new InstancedMesh uuid + actual count. For 'grid' the count is
// derived from nx*ny*nz (the caller's `count` is ignored, matching
// Maya MASH's grid distribute behaviour).
function MASHDistribute(opts) {
  const o = opts || {};
  const sourceUuid = o.sourceUuid;
  const mode = o.mode || 'linear';
  const count = (o.count === undefined) ? 10 : (o.count | 0);
  if (!sourceUuid) return { ok: false, error: 'sourceUuid required' };
  const mats = _matricesFor(mode, count, o.params || {});
  if (!mats || mats.length === 0) return { ok: false, error: 'unknown mode or zero count' };
  const res = replicateInstanced(sourceUuid, mats.length, mats);
  if (!res.ok) return res;
  tagMode(res.uuid, mode);
  return { ok: true, uuid: res.uuid, count: res.count, sourceUuid, mode };
}

function MASHReplicate(opts) {
  const o = opts || {};
  const sourceUuid = o.sourceUuid;
  const count = (o.count === undefined) ? 10 : (o.count | 0);
  if (!sourceUuid) return { ok: false, error: 'sourceUuid required' };
  return replicateInstanced(sourceUuid, count, o.transforms);
}

function MASHEffector(opts) {
  const o = opts || {};
  if (!o.uuid) return { ok: false, error: 'uuid required' };
  if (!o.kind) return { ok: false, error: 'kind required' };
  const h = getHandles().get(o.uuid);
  if (!h) return { ok: false, error: 'no handle' };
  const eff = { kind: o.kind, params: o.params || {} };
  const stack = h.effectors.concat(eff);
  return applyEffectorStack(o.uuid, stack);
}

function MASHList() {
  return { ok: true, items: listHandles() };
}

function MASHRemove(opts) {
  const o = opts || {};
  if (!o.uuid) return { ok: false, error: 'uuid required' };
  return removeHandle(o.uuid);
}

// Called by installMASH() in index.js so the slice-699 module owns the
// install lifecycle and ops registration timing.
export function installMASHArrange() {
  const ops = {
    __studioMASHDistribute: MASHDistribute,
    __studioMASHReplicate: MASHReplicate,
    __studioMASHEffector: MASHEffector,
    __studioMASHList: MASHList,
    __studioMASHRemove: MASHRemove,
  };
  for (const [name, fn] of Object.entries(ops)) {
    if (typeof window !== 'undefined') window[name] = fn;
  }
  registerOps(ops, 'mograph', 'Maya MASH arrange + distribute + effector pipeline');
}
