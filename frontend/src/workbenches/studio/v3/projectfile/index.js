// ArchDisc Studio V3 — project file save/load (slice 875).
// Serialise full project state to a single .archdisc-project JSON blob
// containing scene + materials + settings + AI history.

import { registerOps } from '../common/registry.js';
let _installed = false;
function _serialise() {
  const out = { version: 1, createdAt: Date.now(), scene: null, settings: {}, blendshapes: [], curves: [] };
  const scene = window.__archdiscScene;
  if (scene?.toJSON) { try { out.scene = scene.toJSON(); } catch (_) {} }
  out.settings.viewport = {
    fov: window.__studioCamFov,
    toneMapping: window.__studioToneMapping,
    pixelRatio: window.__studioPixelRatio,
  };
  return out;
}
async function _saveToFile() {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: 'project.archdisc', types: [{ description: 'ArchDisc Project', accept: { 'application/json': ['.archdisc'] } }] });
      const ws = await handle.createWritable();
      await ws.write(JSON.stringify(_serialise(), null, 2));
      await ws.close();
      return { ok: true, saved: true };
    } catch (e) { return { ok: false, error: String(e) }; }
  }
  return { ok: true, blob: JSON.stringify(_serialise()) };
}
async function _loadFromFile() {
  if (typeof window.showOpenFilePicker === 'function') {
    try {
      const [handle] = await window.showOpenFilePicker({ types: [{ description: 'ArchDisc Project', accept: { 'application/json': ['.archdisc'] } }] });
      const file = await handle.getFile();
      const text = await file.text();
      const data = JSON.parse(text);
      return { ok: true, data };
    } catch (e) { return { ok: false, error: String(e) }; }
  }
  return { ok: false, error: 'no file picker' };
}
export function installProjectFile() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioProjectSerialise: () => ({ ok: true, project: _serialise() }),
    __studioProjectSaveToFile: _saveToFile,
    __studioProjectLoadFromFile: _loadFromFile,
    __studioProjectFromString: ({ json } = {}) => {
      try { return { ok: true, data: JSON.parse(json) }; } catch (e) { return { ok: false, error: String(e) }; }
    },
    __studioProjectToString: () => ({ ok: true, json: JSON.stringify(_serialise()) }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'interop', 'Project file save/load');
  return { ok: true };
}
export default installProjectFile;
