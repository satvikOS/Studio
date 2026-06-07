// ArchDisc Studio V3 — game save/load (slice 842).
// localStorage-backed save slots + JSON.stringify of arbitrary state.

import { registerOps } from '../common/registry.js';
let _installed = false;
const _NS = 'archdisc.game.save.';
export function installSaveLoad() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioSaveCreate: ({ slot, state } = {}) => {
      try { localStorage.setItem(_NS + slot, JSON.stringify(state ?? {})); return { ok: true, slot }; } catch (e) { return { ok: false, error: String(e) }; }
    },
    __studioSaveLoad: ({ slot } = {}) => {
      try { const s = localStorage.getItem(_NS + slot); return { ok: !!s, state: s ? JSON.parse(s) : null }; } catch (e) { return { ok: false, error: String(e) }; }
    },
    __studioSaveList: () => {
      const slots = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i); if (k?.startsWith(_NS)) slots.push(k.slice(_NS.length));
      }
      return { ok: true, slots };
    },
    __studioSaveDelete: ({ slot } = {}) => { localStorage.removeItem(_NS + slot); return { ok: true }; },
    __studioSaveSerializeScene: () => {
      const scene = window.__archdiscScene; if (!scene) return { ok: false };
      const objs = [];
      scene.traverse((o) => {
        if (!o.userData?.archdiscStudioPrimitive) return;
        objs.push({
          uuid: o.uuid, name: o.name,
          kind: o.userData.archdiscStudioPrimitiveKind,
          pos: o.position.toArray(),
          rot: o.rotation.toArray().slice(0, 3),
          scale: o.scale.toArray(),
        });
      });
      return { ok: true, state: { objects: objs } };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'game', 'Game save/load');
  return { ok: true };
}
export default installSaveLoad;
