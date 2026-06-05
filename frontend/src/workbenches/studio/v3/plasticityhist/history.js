// Slice 701 — Parametric history stack for surface ops. Each entry
// records (op, args) on a target mesh; "rewind" rebuilds from the base
// geometry by re-applying all enabled ops in order. Enables Plasticity-
// like non-destructive editing of fillet/chamfer/offset/shell etc.

const _histories = new Map();   // meshUuid → { base: BufferGeometry, entries: [{uuid, op, args, enabled, label}] }

let _seq = 1;
function _uuid() { return `ph-${_seq++}-${Date.now().toString(36)}`; }

function _captureBase(mesh) {
  if (!mesh.userData) mesh.userData = {};
  if (!mesh.userData.archdiscStudioParamBase) {
    mesh.userData.archdiscStudioParamBase = mesh.geometry.clone();
  }
  return mesh.userData.archdiscStudioParamBase;
}

export function ensureHistory(meshUuid) {
  const scene = window.__archdiscScene;
  if (!scene) return null;
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh || !mesh.geometry) return null;
  if (!_histories.has(meshUuid)) {
    _histories.set(meshUuid, { base: _captureBase(mesh), entries: [] });
  }
  return _histories.get(meshUuid);
}

export function recordOp(meshUuid, op, args, label) {
  const h = ensureHistory(meshUuid);
  if (!h) return { ok: false };
  const entry = { uuid: _uuid(), op, args: args || [], enabled: true, label: label || op };
  h.entries.push(entry);
  return { ok: true, uuid: entry.uuid, count: h.entries.length };
}

export function setEnabled(meshUuid, entryUuid, enabled) {
  const h = _histories.get(meshUuid);
  if (!h) return { ok: false };
  const e = h.entries.find((x) => x.uuid === entryUuid);
  if (!e) return { ok: false };
  e.enabled = !!enabled;
  return rebuild(meshUuid);
}

export function reorder(meshUuid, entryUuid, newIdx) {
  const h = _histories.get(meshUuid);
  if (!h) return { ok: false };
  const i = h.entries.findIndex((x) => x.uuid === entryUuid);
  if (i < 0) return { ok: false };
  const [e] = h.entries.splice(i, 1);
  h.entries.splice(Math.max(0, Math.min(h.entries.length, newIdx)), 0, e);
  return rebuild(meshUuid);
}

export function removeEntry(meshUuid, entryUuid) {
  const h = _histories.get(meshUuid);
  if (!h) return { ok: false };
  h.entries = h.entries.filter((x) => x.uuid !== entryUuid);
  return rebuild(meshUuid);
}

export function setArgs(meshUuid, entryUuid, args) {
  const h = _histories.get(meshUuid);
  if (!h) return { ok: false };
  const e = h.entries.find((x) => x.uuid === entryUuid);
  if (!e) return { ok: false };
  e.args = args || [];
  return rebuild(meshUuid);
}

export function rebuild(meshUuid) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh) return { ok: false };
  const h = _histories.get(meshUuid);
  if (!h) return { ok: false };
  // Restore base.
  mesh.geometry.dispose();
  mesh.geometry = h.base.clone();
  // Replay enabled entries.
  let applied = 0;
  for (const e of h.entries) {
    if (!e.enabled) continue;
    const fn = window[e.op];
    if (typeof fn !== 'function') continue;
    try { fn(meshUuid, ...e.args); applied++; } catch (_) {}
  }
  return { ok: true, applied, total: h.entries.length };
}

export function flatten(meshUuid) {
  // Bake current state into a new base, clear history.
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh) return { ok: false };
  const h = _histories.get(meshUuid);
  if (h) { h.base = mesh.geometry.clone(); h.entries = []; }
  if (mesh.userData) mesh.userData.archdiscStudioParamBase = mesh.geometry.clone();
  return { ok: true };
}

export function listEntries(meshUuid) {
  const h = _histories.get(meshUuid);
  if (!h) return { ok: false };
  return {
    ok: true,
    count: h.entries.length,
    entries: h.entries.map((e) => ({ uuid: e.uuid, op: e.op, label: e.label, enabled: e.enabled, args: e.args })),
  };
}

export function exportHistory(meshUuid) {
  const h = _histories.get(meshUuid);
  if (!h) return { ok: false };
  return { ok: true, json: JSON.stringify({ entries: h.entries }) };
}
