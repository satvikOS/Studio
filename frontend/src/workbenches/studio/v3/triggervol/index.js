// ArchDisc Studio V3 — trigger volumes (slice 844).
// AABB trigger zones in world space that fire enter/exit callbacks
// when tracked transforms cross the boundary.

import { registerOps } from '../common/registry.js';
let _installed = false;
const _vols = new Map();   // id → {bbox:[x,y,z,X,Y,Z], onEnter, onExit, tracked: Set<uuid>, inside: Set<uuid>}
const _tracked = new Set();
let _hookInstalled = false;
function _aabbContains(box, p) {
  return p[0] >= box[0] && p[0] <= box[3] && p[1] >= box[1] && p[1] <= box[4] && p[2] >= box[2] && p[2] <= box[5];
}
function _tick() {
  const scene = window.__archdiscScene; if (!scene) return;
  for (const vol of _vols.values()) {
    for (const uuid of _tracked) {
      const obj = scene.getObjectByProperty('uuid', uuid); if (!obj) continue;
      const inside = _aabbContains(vol.bbox, [obj.position.x, obj.position.y, obj.position.z]);
      const was = vol.inside.has(uuid);
      if (inside && !was) { vol.inside.add(uuid); try { vol.onEnter?.(uuid); } catch (_) {} }
      else if (!inside && was) { vol.inside.delete(uuid); try { vol.onExit?.(uuid); } catch (_) {} }
    }
  }
}
function _hook() {
  if (_hookInstalled) return; _hookInstalled = true;
  const vp = window.__archdiscViewport;
  if (vp) { const prev = vp.__studioAnimTick; vp.__studioAnimTick = (n) => { prev?.(n); _tick(); }; }
}
export function installTriggerVol() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioTriggerAdd: ({ bbox, onEnter, onExit } = {}) => {
      const id = `vol_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
      _vols.set(id, { bbox: bbox.slice(), onEnter, onExit, inside: new Set() });
      _hook(); return { ok: true, id };
    },
    __studioTriggerRemove: ({ id } = {}) => { _vols.delete(id); return { ok: true }; },
    __studioTriggerTrack: ({ uuid } = {}) => { _tracked.add(uuid); return { ok: true }; },
    __studioTriggerUntrack: ({ uuid } = {}) => { _tracked.delete(uuid); return { ok: true }; },
    __studioTriggerList: () => ({ ok: true, volumes: [..._vols.keys()] }),
    __studioTriggerInside: ({ id } = {}) => ({ ok: true, uuids: [...(_vols.get(id)?.inside || [])] }),
    __studioTriggerTick: () => { _tick(); return { ok: true }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'game', 'Trigger volumes');
  return { ok: true };
}
export default installTriggerVol;
