// Slice 701 — Architectural prefabs (stairs, railings, terrain, sections).

import { registerOps } from '../common/registry.js';
import { createStairs, createRailing, createTerrain, createSection } from './stairs.js';

let _installed = false;

function _addToScene(obj) {
  if (!obj) return { ok: false };
  if (window.__archdiscScene) window.__archdiscScene.add(obj);
  if (typeof window.__studioSelectMesh === 'function' && obj.isMesh) {
    try { window.__studioSelectMesh(obj); } catch (_) {}
  }
  return { ok: true, uuid: obj.uuid };
}

export function installArchExtra() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioArchExtraStairs: (opts) => _addToScene(createStairs(opts)),
    __studioArchExtraRailing: (p1, p2, opts) => _addToScene(createRailing(p1, p2, opts)),
    __studioArchExtraTerrain: (opts) => _addToScene(createTerrain(opts)),
    __studioArchExtraSection: (meshUuid, planeNormal, planeOffset) => _addToScene(createSection(meshUuid, planeNormal, planeOffset)),
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'arch', 'Arch extras — stairs, railings, terrain, section cuts');
}
