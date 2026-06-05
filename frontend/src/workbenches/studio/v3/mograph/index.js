// ArchDisc Studio V3 — MoGraph install / public surface.
//
// `installMoGraph()` binds every cloner/effector/field op to
// `window.__studio*` and registers each with the V3 command palette
// under category 'mograph'. Idempotent (guarded by
// `window.__studioMoGraphInstalled`).
//
// The autoloader (mograph/autoload.js) calls this on import; the
// orchestrator wires it via `import('./mograph/autoload.js')` in
// api.js. We deliberately don't touch api.js / StudioShellV3.jsx
// ourselves — the e2e spec dynamic-imports the autoload module
// against the dev server until the orchestrator wires it.

import {
  clonerLinear, clonerRadial, clonerGrid, clonerOnObject, listCloners,
} from './cloner.js';
import {
  effectorRandom, effectorPlain, effectorStep, effectorBindField, listEffectors,
} from './effector.js';
import {
  createSphereField, createBoxField, createRandomField,
  listFields, getField, removeField, sampleField,
} from './field.js';
import { registerOp } from '../common/registry.js';

function reg(name, fn, description) {
  registerOp(name, fn, 'mograph', description);
}

export function installMoGraph() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (window.__studioMoGraphInstalled) return { ok: true, alreadyInstalled: true };
  window.__studioMoGraphInstalled = true;

  // ─── Cloners ──────────────────────────────────────────────────────────
  reg('__studioClonerLinear',
    (count, offsetXYZ) => clonerLinear(count, offsetXYZ),
    'Cloner — N copies of the active mesh along a line (offset per step).');
  reg('__studioClonerRadial',
    (count, radius, axis) => clonerRadial(count, radius, axis || 'y'),
    'Cloner — N copies evenly around a circle (axis y/x/z).');
  reg('__studioClonerGrid',
    (nx, ny, nz, spacingXYZ) => clonerGrid(nx, ny, nz, spacingXYZ),
    'Cloner — Nx×Ny×Nz 3D grid of the active mesh.');
  reg('__studioClonerOnObject',
    (targetMeshUuid) => clonerOnObject(targetMeshUuid),
    'Cloner — one copy per vertex of a target mesh (in world space).');
  reg('__studioClonerList',
    () => listCloners(),
    'List every cloner-emitted InstancedMesh in the scene.');

  // ─── Effectors ────────────────────────────────────────────────────────
  reg('__studioEffectorRandom',
    (clonerUuid, posJitter, rotJitter, scaleJitter) =>
      effectorRandom(clonerUuid, posJitter, rotJitter, scaleJitter),
    'Effector — deterministic random offset per instance (re-bases from cloner snapshot).');
  reg('__studioEffectorPlain',
    (clonerUuid, positionXYZ, rotationXYZ, scaleXYZ) =>
      effectorPlain(clonerUuid, positionXYZ, rotationXYZ, scaleXYZ),
    'Effector — uniform offset on every instance.');
  reg('__studioEffectorStep',
    (clonerUuid, perStep) => effectorStep(clonerUuid, perStep),
    'Effector — progressive per-step offset (index-scaled position/rotation/scale).');
  reg('__studioEffectorBindField',
    (effectorUuid, fieldUuid) => effectorBindField(effectorUuid, fieldUuid),
    'Bind a field to an effector so its delta is multiplied by the field weight.');
  reg('__studioEffectorList',
    () => listEffectors(),
    'List every registered effector with its cloner + field binding.');

  // ─── Fields ───────────────────────────────────────────────────────────
  reg('__studioFieldSphere',
    (centerXYZ, radius) => createSphereField(centerXYZ, radius),
    'Field — radial sphere falloff (1 at centre, 0 at radius edge).');
  reg('__studioFieldBox',
    (minXYZ, maxXYZ) => createBoxField(minXYZ, maxXYZ),
    'Field — axis-aligned box with per-face fade (1 inside, 0 outside).');
  reg('__studioFieldRandom',
    (seed) => createRandomField(seed),
    'Field — deterministic per-position random weight (seeded mulberry32).');
  reg('__studioFieldList',
    () => listFields(),
    'List every registered field with its kind + params.');
  reg('__studioFieldGet',
    (uuid) => {
      const f = getField(uuid);
      if (!f) return { ok: false, error: 'no field by uuid' };
      return { ok: true, uuid, kind: f.kind, params: { ...f.params } };
    },
    'Get a field record by uuid.');
  reg('__studioFieldRemove',
    (uuid) => removeField(uuid),
    'Remove a field by uuid.');
  reg('__studioFieldSample',
    (uuid, clonePos) => sampleField(uuid, clonePos),
    'Sample a field weight at a world-space position (test helper).');

  return { ok: true, alreadyInstalled: false };
}

export function uninstallMoGraph() {
  if (typeof window === 'undefined') return { ok: false };
  const names = [
    '__studioClonerLinear', '__studioClonerRadial', '__studioClonerGrid',
    '__studioClonerOnObject', '__studioClonerList',
    '__studioEffectorRandom', '__studioEffectorPlain', '__studioEffectorStep',
    '__studioEffectorBindField', '__studioEffectorList',
    '__studioFieldSphere', '__studioFieldBox', '__studioFieldRandom',
    '__studioFieldList', '__studioFieldGet', '__studioFieldRemove', '__studioFieldSample',
  ];
  for (const k of names) {
    try { delete window[k]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(k); } catch (_) {}
    }
  }
  window.__studioMoGraphInstalled = false;
  return { ok: true };
}
