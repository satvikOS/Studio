// Slice 753 — Maya MASH arrange (Replicate + Effector stack).
//
// `replicateInstanced` builds an InstancedMesh from a source mesh +
// either an explicit Matrix4[] (pass-through) or a default identity
// stack of `count` instances. It records the base matrices so any
// effector applied afterwards re-bases from them — that's the bit that
// makes the stack deterministic when you stack two effectors that both
// want to mutate Y.
//
// `applyEffectorStack` walks the registered effector list, sums each
// effector's `{posOffset, rotOffset, scaleMul}` delta on top of the base
// matrix, and writes the composed Matrix4 back into the InstancedMesh.

import * as THREE from 'three';
import { makeInstancedMesh, setInstanceMatrices } from '../common/instance.js';
import { EFFECTOR_KINDS } from './effector.js';

// Internal registry of every replicate handle. Exposed via `getHandles()`
// for the ops layer; tests touch through the ops layer only.
const _handles = new Map();
let _seq = 1;
function _uuid() { return `mash-rep-${_seq++}-${Date.now().toString(36)}`; }

export function getHandles() { return _handles; }

// Build the per-instance base matrix array as Float32-elements clones so
// effectors can read tx/ty/tz without touching the THREE.Matrix4 cache.
function _snapshotBase(matrices) {
  const N = matrices.length;
  const out = new Array(N);
  for (let i = 0; i < N; i++) out[i] = matrices[i].elements.slice(0);
  return out;
}

// Identity transform fallback when `transforms` isn't supplied. Each
// instance stacks at the origin (effectors still differentiate them via
// idx-based math).
function _identityMatrices(count) {
  const N = Math.max(0, count | 0);
  const out = new Array(N);
  for (let i = 0; i < N; i++) out[i] = new THREE.Matrix4();
  return out;
}

// Public: build an InstancedMesh from `sourceUuid` using either a
// supplied `transforms` array (Matrix4[]) or an identity stack of
// `count` instances. Registers the handle and returns the new mesh's
// uuid + final instance count.
export function replicateInstanced(sourceUuid, count, transforms) {
  const scene = window && window.__archdiscScene;
  if (!scene) return { ok: false, error: 'no scene' };
  const src = scene.getObjectByProperty('uuid', sourceUuid);
  if (!src || !src.geometry || !src.material) {
    return { ok: false, error: 'no source mesh' };
  }
  const mats = (Array.isArray(transforms) && transforms.length > 0)
    ? transforms
    : _identityMatrices(count);
  const N = mats.length;
  const im = makeInstancedMesh(src, mats, 'mash-replicate', { sourceUuid });
  scene.add(im);
  const uuid = im.uuid;
  _handles.set(uuid, {
    uuid,
    sourceUuid,
    count: N,
    baseMatrices: _snapshotBase(mats),
    effectors: [],
    instancedMesh: im,
    mode: null,
  });
  return { ok: true, uuid, count: N };
}

// Public: register an effector on an existing replicate handle and
// re-evaluate the stack. The mutation always reads from `baseMatrices`,
// so calling this repeatedly with different effector params doesn't
// "drift" — the previous effector's output isn't fed back in.
export function applyEffectorStack(uuid, effectors) {
  const h = _handles.get(uuid);
  if (!h) return { ok: false, error: 'no handle' };
  if (!Array.isArray(effectors)) return { ok: false, error: 'effectors[] required' };
  const N = h.baseMatrices.length;
  const reusable = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const baseQ = new THREE.Quaternion();
  const baseS = new THREE.Vector3();
  const baseP = new THREE.Vector3();
  const offEuler = new THREE.Euler();
  const offQ = new THREE.Quaternion();
  const composed = new Array(N);
  for (let i = 0; i < N; i++) {
    const elems = h.baseMatrices[i];
    reusable.fromArray(elems);
    reusable.decompose(baseP, baseQ, baseS);
    // Accumulator deltas.
    let dx = 0, dy = 0, dz = 0;
    let rx = 0, ry = 0, rz = 0;
    let sx = 1, sy = 1, sz = 1;
    for (const eff of effectors) {
      const fn = EFFECTOR_KINDS[eff.kind];
      if (!fn) continue;
      const d = fn(i, elems, eff.params || {});
      if (d && d.posOffset) {
        dx += d.posOffset[0] || 0;
        dy += d.posOffset[1] || 0;
        dz += d.posOffset[2] || 0;
      }
      if (d && d.rotOffset) {
        rx += d.rotOffset[0] || 0;
        ry += d.rotOffset[1] || 0;
        rz += d.rotOffset[2] || 0;
      }
      if (d && d.scaleMul) {
        sx *= (d.scaleMul[0] !== undefined ? d.scaleMul[0] : 1);
        sy *= (d.scaleMul[1] !== undefined ? d.scaleMul[1] : 1);
        sz *= (d.scaleMul[2] !== undefined ? d.scaleMul[2] : 1);
      }
    }
    v.set(baseP.x + dx, baseP.y + dy, baseP.z + dz);
    offEuler.set(rx, ry, rz);
    offQ.setFromEuler(offEuler);
    q.copy(baseQ).multiply(offQ);
    s.set(baseS.x * sx, baseS.y * sy, baseS.z * sz);
    const m = new THREE.Matrix4();
    m.compose(v, q, s);
    composed[i] = m;
  }
  setInstanceMatrices(h.instancedMesh, composed);
  h.effectors = effectors.slice(0);
  return { ok: true };
}

export function removeHandle(uuid) {
  const h = _handles.get(uuid);
  if (!h) return { ok: false };
  if (h.instancedMesh && h.instancedMesh.parent) {
    h.instancedMesh.parent.remove(h.instancedMesh);
  }
  _handles.delete(uuid);
  return { ok: true };
}

export function listHandles() {
  return Array.from(_handles.values()).map((h) => ({
    uuid: h.uuid,
    sourceUuid: h.sourceUuid,
    count: h.count,
    mode: h.mode,
    effectors: h.effectors.map((e) => e.kind),
  }));
}

// Lets ops.js stash the distribute mode on the handle so list() can
// report it without leaking arrange internals.
export function tagMode(uuid, mode) {
  const h = _handles.get(uuid);
  if (h) h.mode = mode;
}
