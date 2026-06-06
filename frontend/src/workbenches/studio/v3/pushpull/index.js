// ArchDisc Studio V3 — SketchUp-style Push/Pull single-face extrude
// (slice 747). Real mesh surgery via ../../modeling/pushPull.js.

import { registerOps } from '../common/registry.js';
import {
  pushPullFace,
  beginPushPullSession,
  applyPushPullDistance,
  commitPushPullSession,
  cancelPushPullSession,
} from '../../modeling/pushPull.js';

let _installed = false;
let _activeSession = null;

function _resolveMesh(uuid) {
  const scene = window.__archdiscScene;
  if (!scene) return null;
  if (uuid) return scene.getObjectByProperty('uuid', uuid) || null;
  if (typeof window.__studioSelectedMesh === 'function') {
    try { return window.__studioSelectedMesh() || null; } catch (_) { return null; }
  }
  return null;
}

export function installPushPull() {
  if (_installed) return;
  _installed = true;

  const ops = {
    // Headless one-shot — the e2e and cmd-palette entry point.
    __studioPushPullFace: (uuid, faceIndex, distance) => {
      const m = _resolveMesh(uuid);
      if (!m) return { ok: false, error: 'no mesh' };
      return pushPullFace(m, faceIndex | 0, Number(distance) || 0);
    },
    // Interactive session — drag-driven distance updates.
    __studioPushPullStart: (uuid, faceIndex) => {
      const m = _resolveMesh(uuid);
      if (!m) return { ok: false, error: 'no mesh' };
      if (_activeSession) cancelPushPullSession(_activeSession);
      const r = beginPushPullSession(m, faceIndex | 0);
      if (!r.ok) return r;
      _activeSession = r.handle;
      return { ok: true, faceArea: r.handle.faceArea, normal: r.handle.normal.slice() };
    },
    __studioPushPullUpdate: (distance) => {
      if (!_activeSession) return { ok: false, error: 'no active session' };
      return applyPushPullDistance(_activeSession, Number(distance) || 0);
    },
    __studioPushPullCommit: () => {
      if (!_activeSession) return { ok: false, error: 'no active session' };
      const r = commitPushPullSession(_activeSession);
      _activeSession = null;
      return r;
    },
    __studioPushPullCancel: () => {
      if (!_activeSession) return { ok: false, error: 'no active session' };
      cancelPushPullSession(_activeSession);
      _activeSession = null;
      return { ok: true };
    },
    __studioPushPullState: () => {
      if (!_activeSession) return { ok: true, active: false };
      return {
        ok: true,
        active: true,
        distance: _activeSession.distance,
        faceArea: _activeSession.faceArea,
        normal: _activeSession.normal.slice(),
        meshUuid: _activeSession.mesh && _activeSession.mesh.uuid,
      };
    },
  };

  for (const [name, fn] of Object.entries(ops)) window[name] = fn;
  registerOps(ops, 'modeling',
    'SketchUp Push/Pull — interactive single-face extrude');
}

export default installPushPull;
