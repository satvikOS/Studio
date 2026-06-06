// ArchDisc Studio V3 — slice 750 — re-editable parametric primitives.
//
// 3ds Max-style "the primitive remembers its construction parameters
// forever". installParamPrim() is idempotent; it:
//
//   • registers the __studioPrimitive{Get,Set,Reset,GetSchema,Stamp}Params
//     op surface with the V3 command palette under category 'paramprim'
//   • carries no UI of its own — the ops are the contract, the V3 prop
//     panel / outliner read userData directly
//
// All ops accept a mesh uuid (or fall back to the active selection
// when uuid is null) and resolve through __archdiscScene.

import {
  buildGeometryFor,
  defaultParamsFor,
  getSchema,
  isParamPrim,
  rebuild,
  readParams,
  reset,
  stamp,
  PARAM_PRIM_KINDS,
} from './rebuild.js';
import { registerOps, unregisterOps } from '../common/registry.js';

let _installed = false;

// ─── Scene + selection lookup ────────────────────────────────────────
function getScene() {
  return (typeof window !== 'undefined') ? window.__archdiscScene : null;
}

function findMeshByUuid(uuid) {
  const scene = getScene();
  if (!scene || !uuid) return null;
  return scene.getObjectByProperty('uuid', uuid) || null;
}

// Resolve a mesh: explicit uuid wins; fall back to the V3 selection
// accessor so callers can pass null and let the active selection be
// used.
function resolveMesh(uuid) {
  if (uuid) {
    const m = findMeshByUuid(uuid);
    if (m) return m;
  }
  if (typeof window === 'undefined') return null;
  if (typeof window.__studioSelectedMesh === 'function') {
    try {
      const m = window.__studioSelectedMesh();
      if (m) return m;
    } catch (_) {}
  }
  return null;
}

// ─── Ops ──────────────────────────────────────────────────────────────
function opGetParams(uuid) {
  const m = resolveMesh(uuid);
  if (!m) return { ok: false, error: 'no mesh' };
  const cur = readParams(m);
  if (!cur) return { ok: false, error: 'not a parametric primitive' };
  return { ok: true, kind: cur.kind, params: cur.params };
}

function opSetParams(uuid, partialParams) {
  const m = resolveMesh(uuid);
  if (!m) return { ok: false, error: 'no mesh' };
  const r = rebuild(m, partialParams || {});
  if (!r.ok) return r;
  return { ok: true, rebuilt: true, kind: r.kind, params: r.params };
}

function opResetParams(uuid) {
  const m = resolveMesh(uuid);
  if (!m) return { ok: false, error: 'no mesh' };
  const r = reset(m);
  if (!r.ok) return r;
  return { ok: true, kind: r.kind, params: r.params };
}

function opGetSchema(uuid) {
  const m = resolveMesh(uuid);
  if (!m) return { ok: false, error: 'no mesh' };
  const cur = readParams(m);
  if (!cur) return { ok: false, error: 'not a parametric primitive' };
  const schema = getSchema(cur.kind);
  return { ok: true, kind: cur.kind, schema };
}

// Retrofit: stamp default params + schema onto an existing mesh of
// the given kind. Useful for meshes spawned before this slice or for
// callers that build their own meshes outside spawnPrimitive().
function opStamp(uuid, kind) {
  const m = resolveMesh(uuid);
  if (!m) return { ok: false, error: 'no mesh' };
  if (!kind) {
    // Allow callers to omit kind when it can be read from userData.
    kind = m.userData && m.userData.archdiscStudioPrimitiveKind;
  }
  if (!kind || !isParamPrim(kind)) {
    return { ok: false, error: 'unknown primitive kind: ' + kind };
  }
  const params = stamp(m, kind, defaultParamsFor(kind));
  return { ok: true, kind, params };
}

// ─── Op registration ──────────────────────────────────────────────────
const OP_NAMES = [
  '__studioPrimitiveGetParams',
  '__studioPrimitiveSetParams',
  '__studioPrimitiveResetParams',
  '__studioPrimitiveGetSchema',
  '__studioPrimitiveStamp',
  '__studioPrimitiveListKinds',
  '__studioPrimitiveBuildGeometry',
];

export function installParamPrim() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, alreadyInstalled: true };
  _installed = true;

  registerOps({
    __studioPrimitiveGetParams: [
      (uuid) => opGetParams(uuid),
      'Read the parametric construction params (kind + values) off a primitive mesh by uuid.',
    ],
    __studioPrimitiveSetParams: [
      (uuid, partial) => opSetParams(uuid, partial),
      'Re-edit a primitive: merge partialParams onto current params, rebuild mesh.geometry from a fresh BufferGeometry, preserve transform/material/userData.',
    ],
    __studioPrimitiveResetParams: [
      (uuid) => opResetParams(uuid),
      'Reset a primitive\'s construction params to schema defaults and rebuild its geometry.',
    ],
    __studioPrimitiveGetSchema: [
      (uuid) => opGetSchema(uuid),
      'Read the min/max/step/default schema for the primitive under the given uuid (so a UI panel can build sliders).',
    ],
    __studioPrimitiveStamp: [
      (uuid, kind) => opStamp(uuid, kind),
      'Retrofit an existing mesh: stamp default archdiscStudioPrimitiveParams + schema for `kind` onto its userData.',
    ],
    __studioPrimitiveListKinds: [
      () => ({ ok: true, kinds: PARAM_PRIM_KINDS.slice() }),
      'Return the list of primitive kinds this module knows how to re-edit.',
    ],
    __studioPrimitiveBuildGeometry: [
      (kind, params) => {
        const g = buildGeometryFor(kind, params || defaultParamsFor(kind));
        const verts = g.attributes && g.attributes.position
          ? g.attributes.position.count : 0;
        const tris = g.index ? g.index.count / 3 : verts / 3;
        return { ok: true, kind, verts, tris };
      },
      'Build a fresh BufferGeometry for (kind, params) and return its vert/tri counts (does not touch the scene).',
    ],
  }, 'paramprim');

  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallParamPrim() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  unregisterOps(OP_NAMES);
  _installed = false;
  return { ok: true };
}

export default installParamPrim;
