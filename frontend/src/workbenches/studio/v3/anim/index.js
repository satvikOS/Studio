// ArchDisc Studio V3 — animation graph install + window.__studioAnim* API.
//
// installAnimGraph() is idempotent. It:
//   • exposes window.__studioAnim* ops described in the slice brief
//   • mounts the GraphEditor component into a body-attached host so we
//     don't have to modify StudioShellV3.jsx
//   • auto-registers every op with the V3 command palette under the
//     'anim' category
//
// Namespace `Anim` deliberately doesn't collide with the older
// `__studioKeyframe*` family living in api.js (slice 629) — that
// pipeline is a thin VectorKeyframeTrack + AnimationMixer system. This
// module is the richer, editable, bezier-handled alternative that the
// graph editor drives directly.

import React from 'react';
import {
  createCurve, addKey, deleteKey,
  setKeyInterp, setKeyHandle, moveKey,
  curveDuration, sample,
  curveToJSON, curveFromJSON,
} from './curves.js';
import {
  getCurves, registerCurve, unregisterCurve, getCurve,
  play as pbPlay, pause as pbPause, setTime as pbSetTime,
  getState as pbGetState, ensureTick, applyAllAtTime,
  timelineDuration, reset as pbReset,
} from './playback.js';
import GraphEditor from './GraphEditor.jsx';
import { mountPanel, unmountPanel } from '../common/panel.js';
import { registerOp, unregisterOps } from '../common/registry.js';

let _installed = false;
let _panel = null;
let _editorOpen = false;
let _activeUuid = null;          // currently-edited curve in the graph

// ─── Mesh helper ─────────────────────────────────────────────────────
function getSelectedMesh() {
  if (typeof window === 'undefined') return null;
  if (typeof window.__studioSelectedMesh === 'function') {
    try { return window.__studioSelectedMesh(); } catch (_) {}
  }
  const vp = window.__archdiscViewport;
  if (vp && typeof vp.getSelected === 'function') {
    try { return vp.getSelected(); } catch (_) {}
  }
  return null;
}

function readMeshValue(mesh, property, channel) {
  if (!mesh) return 0;
  const ch = ['x', 'y', 'z'][Math.max(0, Math.min(2, channel || 0))];
  if (property === 'position' && mesh.position) return mesh.position[ch];
  if (property === 'scale' && mesh.scale)       return mesh.scale[ch];
  if (property === 'rotation' && mesh.rotation) return mesh.rotation[ch];
  return 0;
}

// ─── Editor lifecycle ────────────────────────────────────────────────
function mountEditorHost() {
  if (_panel) return _panel.host;
  _panel = mountPanel('anim-graph-editor');
  return _panel ? _panel.host : null;
}

function renderEditor() {
  if (!_panel) return;
  if (!_editorOpen) {
    _panel.render(null);
    return;
  }
  _panel.render(
    React.createElement(GraphEditor, {
      getCurves: () => getCurves(),
      getActiveUuid: () => _activeUuid,
      setActiveUuid: (u) => { _activeUuid = u; renderEditor(); },
      getTime: () => pbGetState().time,
      setTime: (t) => { pbSetTime(t); renderEditor(); },
      play: () => { pbPlay(); renderEditor(); pumpRender(); },
      pause: () => { pbPause(); renderEditor(); },
      isPlaying: () => pbGetState().playing,
      addCurveForSelection: (property, channel) =>
        window.__studioAnimCurveAdd(undefined, property, channel),
      addKeyAtCursor: () => {
        const c = _activeUuid && getCurve(_activeUuid);
        if (!c) return;
        const t = pbGetState().time;
        const mesh = c.meshUuid ? findMeshByUuid(c.meshUuid) : getSelectedMesh();
        const v = readMeshValue(mesh, c.property, c.channel);
        addKey(c, t, v);
        applyAllAtTime(pbGetState().time);
      },
      deleteSelectedKey: (idx) => {
        const c = _activeUuid && getCurve(_activeUuid);
        if (!c) return;
        deleteKey(c, idx);
        applyAllAtTime(pbGetState().time);
      },
      setInterp: (idx, interp) => {
        const c = _activeUuid && getCurve(_activeUuid);
        if (!c) return;
        setKeyInterp(c, idx, interp);
        applyAllAtTime(pbGetState().time);
      },
      onMutate: () => { applyAllAtTime(pbGetState().time); },
      onCloseRequest: () => editorClose(),
    })
  );
}

// While playing, push a re-render every animation frame so the
// playhead + viewport reflect motion. Stops when paused/closed.
let _pumpRaf = 0;
function pumpRender() {
  if (_pumpRaf) cancelAnimationFrame(_pumpRaf);
  const step = () => {
    if (!_editorOpen) { _pumpRaf = 0; return; }
    renderEditor();
    if (pbGetState().playing) {
      _pumpRaf = requestAnimationFrame(step);
    } else {
      _pumpRaf = 0;
    }
  };
  _pumpRaf = requestAnimationFrame(step);
}

function editorOpen() {
  mountEditorHost();
  _editorOpen = true;
  renderEditor();
  return { ok: true, open: true };
}
function editorClose() {
  _editorOpen = false;
  renderEditor();
  if (_pumpRaf) { cancelAnimationFrame(_pumpRaf); _pumpRaf = 0; }
  return { ok: true, open: false };
}
function editorToggle() {
  return _editorOpen ? editorClose() : editorOpen();
}

function findMeshByUuid(uuid) {
  if (typeof window === 'undefined') return null;
  const scene = window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene);
  if (!scene || typeof scene.getObjectByProperty !== 'function') return null;
  return scene.getObjectByProperty('uuid', uuid);
}

// ─── Op registration ─────────────────────────────────────────────────
function reg(name, fn, description) {
  registerOp(name, fn, 'anim', description);
}

// ─── Install ─────────────────────────────────────────────────────────
export function installAnimGraph() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  // Add a new curve. If meshUuid is omitted, use the current selection.
  reg('__studioAnimCurveAdd', (meshUuid, property, channel) => {
    let mu = meshUuid;
    if (!mu) {
      const sel = getSelectedMesh();
      if (!sel) return { ok: false, error: 'no mesh selected' };
      mu = sel.uuid;
    }
    const c = createCurve(mu, property || 'position', channel || 0);
    // Seed with two keys at t=0 (current value) and t=1 (current value
    // +0.5) so the curve is immediately samplable + visible.
    const mesh = findMeshByUuid(mu) || getSelectedMesh();
    const v0 = readMeshValue(mesh, c.property, c.channel);
    addKey(c, 0, v0);
    addKey(c, 1, v0 + 0.5);
    registerCurve(c);
    _activeUuid = c.uuid;
    ensureTick();
    if (_editorOpen) renderEditor();
    return { ok: true, uuid: c.uuid, meshUuid: mu, property: c.property, channel: c.channel };
  }, 'Add a bezier animation curve for (mesh, property, channel).');

  reg('__studioAnimCurveAddKey', (curveUuid, time, value, inHandle, outHandle, interp) => {
    const c = getCurve(curveUuid);
    if (!c) return { ok: false, error: 'curve not found' };
    const count = addKey(c, time, value, inHandle, outHandle, interp);
    if (_editorOpen) renderEditor();
    return { ok: true, count };
  }, 'Insert a keyframe at time t with optional bezier handles.');

  reg('__studioAnimCurveListKeys', (curveUuid) => {
    const c = getCurve(curveUuid);
    if (!c) return { ok: false, error: 'curve not found' };
    return {
      ok: true, count: c.keys.length,
      keys: c.keys.map((k) => ({
        time: k.time, value: k.value,
        inHandle: { ...k.inHandle },
        outHandle: { ...k.outHandle },
        interp: k.interp,
      })),
    };
  }, 'List every keyframe in a curve (time, value, handles, interp).');

  reg('__studioAnimCurveSample', (curveUuid, t) => {
    const c = getCurve(curveUuid);
    if (!c) return { ok: false, error: 'curve not found' };
    return { ok: true, value: sample(c, t) };
  }, 'Evaluate a curve at time t.');

  reg('__studioAnimCurveDeleteKey', (curveUuid, idx) => {
    const c = getCurve(curveUuid);
    if (!c) return { ok: false, error: 'curve not found' };
    const count = deleteKey(c, idx);
    if (_editorOpen) renderEditor();
    return { ok: true, count };
  }, 'Delete a keyframe by index.');

  reg('__studioAnimCurveSetInterp', (curveUuid, idx, interp) => {
    const c = getCurve(curveUuid);
    if (!c) return { ok: false, error: 'curve not found' };
    const ok = setKeyInterp(c, idx, interp);
    if (_editorOpen) renderEditor();
    return { ok };
  }, 'Set a key\'s interpolation mode (bezier/linear/step).');

  reg('__studioAnimCurveSetHandle', (curveUuid, idx, which, x, y) => {
    const c = getCurve(curveUuid);
    if (!c) return { ok: false, error: 'curve not found' };
    const ok = setKeyHandle(c, idx, which, x, y);
    if (_editorOpen) renderEditor();
    return { ok };
  }, 'Set a key\'s in/out tangent handle (which="in"|"out", x in s, y in val units).');

  reg('__studioAnimCurveMoveKey', (curveUuid, idx, time, value) => {
    const c = getCurve(curveUuid);
    if (!c) return { ok: false, error: 'curve not found' };
    const ok = moveKey(c, idx, time, value);
    if (_editorOpen) renderEditor();
    return { ok };
  }, 'Move a key to a new (time, value) — re-sorts internally.');

  reg('__studioAnimCurveRemove', (curveUuid) => {
    const ok = unregisterCurve(curveUuid);
    if (_activeUuid === curveUuid) _activeUuid = null;
    if (_editorOpen) renderEditor();
    return { ok };
  }, 'Remove a curve entirely.');

  reg('__studioAnimCurveDuration', (curveUuid) => {
    const c = getCurve(curveUuid);
    if (!c) return { ok: false, error: 'curve not found' };
    return { ok: true, duration: curveDuration(c) };
  }, 'Return a curve\'s duration (last key\'s time).');

  reg('__studioAnimListCurves', () => {
    const out = [];
    getCurves().forEach((c) => out.push({
      uuid: c.uuid, meshUuid: c.meshUuid,
      property: c.property, channel: c.channel, keyCount: c.keys.length,
    }));
    return { ok: true, count: out.length, curves: out };
  }, 'List every registered animation curve.');

  reg('__studioAnimSetActiveCurve', (curveUuid) => {
    if (!getCurve(curveUuid)) return { ok: false, error: 'curve not found' };
    _activeUuid = curveUuid;
    if (_editorOpen) renderEditor();
    return { ok: true, uuid: curveUuid };
  }, 'Set the curve highlighted in the graph editor.');

  reg('__studioAnimGetActiveCurve', () =>
    ({ ok: true, uuid: _activeUuid }),
    'Return the curve currently focused in the graph editor.');

  // Transport.
  reg('__studioAnimPlay', () => {
    const r = pbPlay();
    if (_editorOpen) { renderEditor(); pumpRender(); }
    return r;
  }, 'Start the curve-driven timeline.');

  reg('__studioAnimPause', () => {
    const r = pbPause();
    if (_editorOpen) renderEditor();
    return r;
  }, 'Pause the curve-driven timeline.');

  reg('__studioAnimSetTime', (t) => {
    const r = pbSetTime(t);
    if (_editorOpen) renderEditor();
    return r;
  }, 'Scrub the timeline to a specific second.');

  reg('__studioAnimGetState', () => ({ ok: true, ...pbGetState() }),
    'Read playing/time/duration/curves.');

  reg('__studioAnimApplyNow', () =>
    ({ ok: true, applied: applyAllAtTime(pbGetState().time) }),
    'Force-write current sampled values into every target mesh.');

  reg('__studioAnimReset', () => {
    pbReset();
    _activeUuid = null;
    if (_editorOpen) renderEditor();
    return { ok: true };
  }, 'Wipe all curves + reset timeline.');

  reg('__studioAnimCurveSerialize', (curveUuid) => {
    const c = getCurve(curveUuid);
    if (!c) return { ok: false, error: 'curve not found' };
    return { ok: true, json: curveToJSON(c) };
  }, 'Serialise a single curve to plain JSON.');

  reg('__studioAnimCurveDeserialize', (json) => {
    const c = curveFromJSON(json);
    if (!c) return { ok: false };
    registerCurve(c);
    _activeUuid = c.uuid;
    if (_editorOpen) renderEditor();
    return { ok: true, uuid: c.uuid, count: c.keys.length };
  }, 'Recreate a curve from JSON produced by Serialize.');

  // Editor toggles.
  reg('__studioAnimGraphEditorOpen', editorOpen, 'Open the animation graph editor.');
  reg('__studioAnimGraphEditorClose', editorClose, 'Close the animation graph editor.');
  reg('__studioAnimGraphEditorToggle', editorToggle, 'Toggle the animation graph editor.');

  // Esc to close.
  const _onKey = (e) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.key === 'Escape' && _editorOpen) { editorClose(); e.preventDefault(); }
  };
  window.addEventListener('keydown', _onKey);

  // Best-effort tick install — viewport may not exist yet at install
  // time during the dev-server cold start. ensureTick() is also called
  // again from play() so this isn't load-bearing.
  ensureTick();

  return { ok: true, alreadyInstalled: false };
}

export function uninstallAnimGraph() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  unregisterOps([
    '__studioAnimCurveAdd', '__studioAnimCurveAddKey', '__studioAnimCurveListKeys',
    '__studioAnimCurveSample', '__studioAnimCurveDeleteKey', '__studioAnimCurveSetInterp',
    '__studioAnimCurveSetHandle', '__studioAnimCurveMoveKey', '__studioAnimCurveRemove',
    '__studioAnimCurveDuration', '__studioAnimListCurves', '__studioAnimSetActiveCurve',
    '__studioAnimGetActiveCurve',
    '__studioAnimPlay', '__studioAnimPause', '__studioAnimSetTime', '__studioAnimGetState',
    '__studioAnimApplyNow', '__studioAnimReset',
    '__studioAnimCurveSerialize', '__studioAnimCurveDeserialize',
    '__studioAnimGraphEditorOpen', '__studioAnimGraphEditorClose', '__studioAnimGraphEditorToggle',
  ]);
  if (_panel) { unmountPanel('anim-graph-editor'); _panel = null; }
  _editorOpen = false;
  _activeUuid = null;
  _installed = false;
  // Don't reset playback — the tick chain is already wired and may be
  // shared by other systems on the same chain.
  return { ok: true };
}

// Convenience export so timelineDuration is reachable from anywhere
// without an import dance — mostly for ad-hoc debugging.
export { timelineDuration };
