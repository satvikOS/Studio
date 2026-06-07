// Slice 773 — Cinema 4D MoGraph Matrix object + Plain/Delay/
// Inheritance/Random effectors.
//
// Surface:
//   __studioC4DMatrixCreate({mode, count, params}) → {ok, matrixKey, count}
//   __studioC4DPlainApply({matrixKey, offset, rotation, scale}) → {ok}
//   __studioC4DDelayApply({matrixKey, target, framesPerInstance, currentFrame, smooth}) → {ok, snapshot}
//   __studioC4DInheritanceApply({matrixKey, sourceMatrixKey, mix}) → {ok}
//   __studioC4DRandomApply({matrixKey, seed, range}) → {ok}
//   __studioC4DMatrixList() → {ok, matrices}
//   __studioC4DMatrixSnapshot({matrixKey}) → {ok, matrices}
//   __studioC4DMatrixDelete({matrixKey}) → {ok}

import { registerOps } from '../common/registry.js';
import {
  createMatrixObject, getMatrixObject, setMatrices, listMatrixObjects,
  deleteMatrixObject,
} from './matrixObject.js';
import {
  plainEffector, delayEffector, inheritanceEffector, randomEffectorC4D,
} from './effectors.js';

let _installed = false;

// Read positions out of a matrix array into a flat [tx,ty,tz][]
// snapshot so callers can verify effector behaviour without having
// to decompose Matrix4s themselves. Used by the e2e spec.
function _positionSnapshot(matrices) {
  const N = matrices.length;
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    const e = matrices[i].elements;
    out[i] = [e[12], e[13], e[14]];
  }
  return out;
}

// ── Matrix object ────────────────────────────────────────────────
function MatrixCreate(opts) {
  return createMatrixObject(opts || {});
}

function MatrixSnapshot(opts) {
  const o = opts || {};
  const h = getMatrixObject(o.matrixKey);
  if (!h) return { ok: false, error: 'no matrix' };
  return { ok: true, matrices: _positionSnapshot(h.matrices), count: h.count };
}

function MatrixList() {
  return { ok: true, matrices: listMatrixObjects() };
}

function MatrixDelete(opts) {
  const o = opts || {};
  if (!deleteMatrixObject(o.matrixKey)) return { ok: false, error: 'no matrix' };
  return { ok: true };
}

// ── Plain effector ───────────────────────────────────────────────
function PlainApply(opts) {
  const o = opts || {};
  const h = getMatrixObject(o.matrixKey);
  if (!h) return { ok: false, error: 'no matrix' };
  const next = plainEffector(h.matrices, {
    offset: o.offset,
    rotation: o.rotation,
    scale: o.scale,
  });
  setMatrices(o.matrixKey, next);
  return { ok: true, count: next.length };
}

// ── Delay effector ───────────────────────────────────────────────
function DelayApply(opts) {
  const o = opts || {};
  const h = getMatrixObject(o.matrixKey);
  if (!h) return { ok: false, error: 'no matrix' };
  const result = delayEffector(
    h.matrices,
    {
      target: o.target,
      framesPerInstance: o.framesPerInstance,
      smooth: o.smooth,
    },
    o.currentFrame,
    h.base,
  );
  setMatrices(o.matrixKey, result.matrices);
  return {
    ok: true,
    snapshot: _positionSnapshot(result.matrices),
    ts: result.ts,
    count: result.matrices.length,
  };
}

// ── Inheritance effector ─────────────────────────────────────────
function InheritanceApply(opts) {
  const o = opts || {};
  const h = getMatrixObject(o.matrixKey);
  if (!h) return { ok: false, error: 'no matrix' };
  const src = getMatrixObject(o.sourceMatrixKey);
  if (!src) return { ok: false, error: 'no source matrix' };
  const next = inheritanceEffector(h.matrices, src.matrices, o.mix);
  setMatrices(o.matrixKey, next);
  return { ok: true, count: next.length };
}

// ── Random effector ──────────────────────────────────────────────
function RandomApply(opts) {
  const o = opts || {};
  const h = getMatrixObject(o.matrixKey);
  if (!h) return { ok: false, error: 'no matrix' };
  const next = randomEffectorC4D(h.matrices, {
    seed: o.seed,
    range: o.range,
  });
  setMatrices(o.matrixKey, next);
  return { ok: true, count: next.length };
}

export function installC4DMograph() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioC4DMatrixCreate: MatrixCreate,
    __studioC4DMatrixList: MatrixList,
    __studioC4DMatrixSnapshot: MatrixSnapshot,
    __studioC4DMatrixDelete: MatrixDelete,
    __studioC4DPlainApply: PlainApply,
    __studioC4DDelayApply: DelayApply,
    __studioC4DInheritanceApply: InheritanceApply,
    __studioC4DRandomApply: RandomApply,
  };
  for (const [name, fn] of Object.entries(ops)) {
    if (typeof window !== 'undefined') window[name] = fn;
  }
  registerOps(
    ops,
    'mograph',
    'C4D MoGraph Matrix object + Plain/Delay/Inheritance/Random effectors',
  );
}
