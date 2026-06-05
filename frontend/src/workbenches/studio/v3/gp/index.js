// ArchDisc Studio V3 — Grease Pencil installer + window.__studioGP* API.
//
// `installGreasePencil()` is idempotent. It:
//   • exposes window.__studioGP* ops described in the slice brief
//   • mounts the GPPanel component into a body-attached host so we
//     don't have to modify StudioShellV3.jsx
//   • auto-registers every op with the V3 command palette under the
//     'gp' category
//   • chains a per-frame visibility update onto window.__archdisc
//     Viewport.__studioAnimTick (see playback.js)
//
// Coexists with the slice 644 `__studioFreehand*` family — that
// pipeline writes raw THREE.Lines straight into the scene with no
// layer / frame concept. This module is the richer alternative that
// drives animated 2D-in-3D drawings.

import React from 'react';
import { mountPanel, unmountPanel } from '../common/panel.js';
import { registerOp, unregisterOps } from '../common/registry.js';

import {
  createStroke, addPoint, setPoints, finalize,
  setColor, setThickness, setHardness, setTaper,
  disposeStroke, strokeLength,
  strokeToJSON, strokeFromJSON, GP_USERDATA_FLAG,
} from './strokes.js';

import {
  addLayer, setActive, toggleVisible, setOpacity,
  deleteLayer, addFrame, deleteFrame,
  listLayers, getActiveUuid, getActiveLayer, getLayer,
  appendStrokeToActiveAt, detachStroke, resetLayers,
} from './layers.js';

import {
  attach as pbAttach, applyVisibility,
  play as pbPlay, pause as pbPause, setTime as pbSetTime,
  getState as pbGetState, ensureTick, setDuration, setLoop,
  reset as pbReset,
} from './playback.js';

import GPPanel from './GPPanel.jsx';

let _installed = false;

// ─── Stroke registry (orchestrator-owned) ────────────────────────────
const _strokes = new Map();   // uuid -> stroke
function getStroke(uuid) { return _strokes.get(uuid) || null; }
function allStrokes() { return Array.from(_strokes.values()); }

// Current "open" stroke being drawn — only one at a time.
let _currentDrawing = null;

// Active brush (defaults the next StrokeStart with no args inherits).
const _brush = {
  thickness: 0.003,
  color: '#ff5577',
};

// Wire the playback module to our stroke registry.
pbAttach({ getStroke });

// ─── Panel lifecycle ─────────────────────────────────────────────────
let _panel = null;
let _open = false;

function mountHost() {
  if (_panel) return _panel.host;
  _panel = mountPanel('gp');
  return _panel ? _panel.host : null;
}

function renderPanel() {
  if (!_panel) return;
  if (!_open) { _panel.render(null); return; }
  _panel.render(
    React.createElement(GPPanel, {
      getLayers: () => listLayers(),
      getActiveUuid: () => getActiveUuid(),
      setActive: (u) => { setActive(u); renderPanel(); },
      addLayer: () => { addLayer(); renderPanel(); },
      deleteLayer: (u) => { deleteLayer(u); renderPanel(); applyVisibility(pbGetState().time); },
      toggleVisible: (u) => { toggleVisible(u); applyVisibility(pbGetState().time); renderPanel(); },
      setOpacity: (u, w) => { setOpacity(u, w); applyVisibility(pbGetState().time); renderPanel(); },
      addFrame: (u, t) => { addFrame(u, t); renderPanel(); },
      deleteFrame: (u, t) => { deleteFrame(u, t); renderPanel(); applyVisibility(pbGetState().time); },
      getTime: () => pbGetState().time,
      setTime: (t) => { pbSetTime(t); renderPanel(); },
      play: () => { pbPlay(); renderPanel(); pumpRender(); },
      pause: () => { pbPause(); renderPanel(); },
      isPlaying: () => pbGetState().playing,
      getDuration: () => pbGetState().duration,
      getStrokeCount: () => _strokes.size,
      getBrush: () => ({ thickness: _brush.thickness, color: _brush.color }),
      setBrushThickness: (t) => { _brush.thickness = Math.max(1e-5, Number(t) || 0); renderPanel(); },
      setBrushColor: (c) => { _brush.color = String(c || '#ff5577'); renderPanel(); },
      onCloseRequest: () => panelClose(),
    })
  );
}

// While playing, push a re-render every animation frame so the
// scrubber + timecode reflect the time cursor. Stops when paused/closed.
let _pumpRaf = 0;
function pumpRender() {
  if (_pumpRaf) cancelAnimationFrame(_pumpRaf);
  const step = () => {
    if (!_open) { _pumpRaf = 0; return; }
    renderPanel();
    if (pbGetState().playing) {
      _pumpRaf = requestAnimationFrame(step);
    } else {
      _pumpRaf = 0;
    }
  };
  _pumpRaf = requestAnimationFrame(step);
}

function panelOpen()   { mountHost(); _open = true;  renderPanel(); return { ok: true, open: true }; }
function panelClose()  { _open = false; renderPanel(); if (_pumpRaf) { cancelAnimationFrame(_pumpRaf); _pumpRaf = 0; } return { ok: true, open: false }; }
function panelToggle() { return _open ? panelClose() : panelOpen(); }

// ─── Scene helper ────────────────────────────────────────────────────
function getScene() {
  if (typeof window === 'undefined') return null;
  if (window.__archdiscScene) return window.__archdiscScene;
  const vp = window.__archdiscViewport;
  if (vp && vp.scene) return vp.scene;
  return null;
}

// ─── Op registration helper (delegates to common/registry.js) ────────
function reg(name, fn, description) {
  registerOp(name, fn, 'gp', description);
}

const OP_NAMES = [
  '__studioGPLayerAdd', '__studioGPLayerList', '__studioGPLayerSetActive',
  '__studioGPLayerToggleVisible', '__studioGPLayerSetOpacity', '__studioGPLayerDelete',
  '__studioGPFrameAdd', '__studioGPFrameDelete',
  '__studioGPStrokeStart', '__studioGPStrokeAddPoint', '__studioGPStrokeFinalize',
  '__studioGPStrokeList', '__studioGPStrokeSetColor', '__studioGPStrokeSetThickness',
  '__studioGPStrokeSetHardness', '__studioGPStrokeSetTaper', '__studioGPStrokeDelete',
  '__studioGPPlay', '__studioGPPause', '__studioGPSetTime', '__studioGPGetState',
  '__studioGPSetDuration', '__studioGPSetLoop',
  '__studioGPBrushSetThickness', '__studioGPBrushSetColor', '__studioGPBrushGet',
  '__studioGPPanelOpen', '__studioGPPanelClose', '__studioGPPanelToggle',
  '__studioGPReset',
  '__studioGPStrokeSerialize', '__studioGPStrokeDeserialize',
];

// ─── Install ─────────────────────────────────────────────────────────
export function installGreasePencil() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, alreadyInstalled: true };
  _installed = true;

  // ── Layer ops ───────────────────────────────────────────────────────
  reg('__studioGPLayerAdd', (name) => {
    const r = addLayer(name);
    if (_open) renderPanel();
    return r;
  }, 'Create a new grease pencil layer (Blender GP-style).');

  reg('__studioGPLayerList', () => listLayers(),
    'List every grease pencil layer with frame counts + active uuid.');

  reg('__studioGPLayerSetActive', (uuid) => {
    const r = setActive(uuid);
    if (_open) renderPanel();
    return r;
  }, 'Set which grease pencil layer the next stroke writes into.');

  reg('__studioGPLayerToggleVisible', (uuid, on) => {
    const r = toggleVisible(uuid, on);
    applyVisibility(pbGetState().time);
    if (_open) renderPanel();
    return r;
  }, 'Toggle a grease pencil layer\'s visibility.');

  reg('__studioGPLayerSetOpacity', (uuid, w) => {
    const r = setOpacity(uuid, w);
    applyVisibility(pbGetState().time);
    if (_open) renderPanel();
    return r;
  }, 'Set a grease pencil layer\'s master opacity (0..1).');

  reg('__studioGPLayerDelete', (uuid) => {
    // Cascade: delete every stroke belonging to any frame on this layer.
    const layer = getLayer(uuid);
    if (layer) {
      layer.frames.forEach((list) => {
        for (const su of list) {
          const s = _strokes.get(su);
          if (s) {
            disposeStroke(s);
            _strokes.delete(su);
          }
        }
      });
    }
    const r = deleteLayer(uuid);
    applyVisibility(pbGetState().time);
    if (_open) renderPanel();
    return r;
  }, 'Delete a grease pencil layer and every stroke it owned.');

  // ── Frame ops ───────────────────────────────────────────────────────
  reg('__studioGPFrameAdd', (layerUuid, time) => {
    const r = addFrame(layerUuid, time);
    if (_open) renderPanel();
    return r;
  }, 'Add (or pick up) a frame at the given scene time on a layer.');

  reg('__studioGPFrameDelete', (layerUuid, time) => {
    // Cascade: remove every stroke that lived in this frame.
    const layer = getLayer(layerUuid);
    if (layer) {
      const t = Math.round(Number(time) * 1000) / 1000;
      const strokes = layer.frames.get(t);
      if (strokes) {
        for (const su of strokes) {
          const s = _strokes.get(su);
          if (s) {
            disposeStroke(s);
            _strokes.delete(su);
          }
        }
      }
    }
    const r = deleteFrame(layerUuid, time);
    applyVisibility(pbGetState().time);
    if (_open) renderPanel();
    return r;
  }, 'Delete a frame (and its strokes) on a layer.');

  // ── Stroke ops ──────────────────────────────────────────────────────
  reg('__studioGPStrokeStart', (thickness, color) => {
    if (_currentDrawing) return { ok: false, error: 'stroke in progress' };
    // Inherit the brush defaults when args are omitted.
    const t = (thickness == null) ? _brush.thickness : thickness;
    const c = (color == null) ? _brush.color : color;
    const s = createStroke({ thickness: t, color: c });
    _currentDrawing = s;
    return { ok: true, uuid: s.uuid };
  }, 'Begin a new stroke on the active layer\'s current frame.');

  reg('__studioGPStrokeAddPoint', (uuid, x, y, z) => {
    // The brief allows either-or: caller may pass uuid OR rely on the
    // currently-open stroke. Both shapes supported.
    let stroke;
    if (typeof uuid === 'string') {
      stroke = _strokes.get(uuid) || (_currentDrawing && _currentDrawing.uuid === uuid ? _currentDrawing : null);
    } else {
      // Single-arg form: treat the first param as `x` and shift.
      z = y; y = x; x = uuid;
      stroke = _currentDrawing;
    }
    if (!stroke) return { ok: false, error: 'no current stroke' };
    const count = addPoint(stroke, x, y, z);
    return { ok: true, count };
  }, 'Append a point [x,y,z] to a stroke (scene-space).');

  reg('__studioGPStrokeFinalize', (uuid) => {
    let stroke;
    if (typeof uuid === 'string') {
      stroke = (_currentDrawing && _currentDrawing.uuid === uuid)
        ? _currentDrawing : _strokes.get(uuid) || null;
    } else {
      stroke = _currentDrawing;
    }
    if (!stroke) return { ok: false, error: 'no stroke' };
    const mesh = finalize(stroke);
    if (!mesh) return { ok: false, error: 'too few points' };
    const scene = getScene();
    if (!scene) return { ok: false, error: 'no scene' };
    scene.add(mesh);
    _strokes.set(stroke.uuid, stroke);

    // Bind to the active layer's frame at the current time. This is the
    // bit that gives strokes their animation behaviour.
    const t = pbGetState().time;
    const bind = appendStrokeToActiveAt(t, stroke.uuid);
    // If there's no active layer yet, the stroke still lives in the
    // scene + registry but won't animate — caller can run LayerAdd then
    // re-bind via FrameAdd. Surface that fact in the return.
    if (_currentDrawing === stroke) _currentDrawing = null;
    applyVisibility(pbGetState().time);
    if (_open) renderPanel();
    return {
      ok: true, uuid: stroke.uuid, meshUuid: mesh.uuid,
      points: stroke.points.length, length: strokeLength(stroke),
      bound: !!bind.ok, layerUuid: bind.layerUuid || null, frameTime: bind.time != null ? bind.time : null,
    };
  }, 'Finalize a stroke: build TubeGeometry, add to scene, bind to layer frame.');

  reg('__studioGPStrokeList', () => ({
    ok: true,
    count: _strokes.size,
    strokes: allStrokes().map((s) => ({
      uuid: s.uuid,
      points: s.points.length,
      thickness: s.thickness,
      color: typeof s.color === 'number' ? '#' + s.color.toString(16).padStart(6, '0') : s.color,
      hardness: s.hardness,
      taper: s.taper,
      finalized: !!s.finalized,
      meshUuid: s.mesh ? s.mesh.uuid : null,
      length: strokeLength(s),
    })),
  }), 'List every grease pencil stroke with its display attributes.');

  reg('__studioGPStrokeSetColor', (uuid, hex) => {
    const s = _strokes.get(uuid);
    if (!s) return { ok: false, error: 'stroke not found' };
    setColor(s, hex);
    return { ok: true, uuid, color: hex };
  }, 'Set a stroke\'s colour (number or hex string).');

  reg('__studioGPStrokeSetThickness', (uuid, t) => {
    const s = _strokes.get(uuid);
    if (!s) return { ok: false, error: 'stroke not found' };
    setThickness(s, t);
    return { ok: true, uuid, thickness: s.thickness };
  }, 'Set a stroke\'s thickness (rebuilds TubeGeometry).');

  reg('__studioGPStrokeSetHardness', (uuid, h) => {
    const s = _strokes.get(uuid);
    if (!s) return { ok: false, error: 'stroke not found' };
    setHardness(s, h);
    applyVisibility(pbGetState().time);
    return { ok: true, uuid, hardness: s.hardness };
  }, 'Set a stroke\'s hardness (drives material opacity).');

  reg('__studioGPStrokeSetTaper', (uuid, taper) => {
    const s = _strokes.get(uuid);
    if (!s) return { ok: false, error: 'stroke not found' };
    setTaper(s, taper);
    return { ok: true, uuid, taper: s.taper };
  }, 'Set a stroke\'s taper [0..1] (stored as userData for future renderer).');

  reg('__studioGPStrokeDelete', (uuid) => {
    const s = _strokes.get(uuid);
    if (!s) return { ok: false, error: 'stroke not found' };
    disposeStroke(s);
    _strokes.delete(uuid);
    detachStroke(uuid);
    applyVisibility(pbGetState().time);
    if (_open) renderPanel();
    return { ok: true, removed: uuid, remaining: _strokes.size };
  }, 'Delete a stroke + remove it from every layer / frame.');

  reg('__studioGPStrokeSerialize', (uuid) => {
    const s = _strokes.get(uuid);
    if (!s) return { ok: false, error: 'stroke not found' };
    return { ok: true, json: strokeToJSON(s) };
  }, 'Serialise a single stroke to JSON.');

  reg('__studioGPStrokeDeserialize', (json) => {
    const s = strokeFromJSON(json);
    if (!s) return { ok: false };
    const mesh = finalize(s);
    if (!mesh) return { ok: false, error: 'too few points' };
    const scene = getScene();
    if (!scene) return { ok: false, error: 'no scene' };
    scene.add(mesh);
    _strokes.set(s.uuid, s);
    appendStrokeToActiveAt(pbGetState().time, s.uuid);
    applyVisibility(pbGetState().time);
    if (_open) renderPanel();
    return { ok: true, uuid: s.uuid, meshUuid: mesh.uuid };
  }, 'Recreate a stroke from JSON produced by Serialize.');

  // ── Brush state ─────────────────────────────────────────────────────
  reg('__studioGPBrushSetThickness', (t) => {
    _brush.thickness = Math.max(1e-5, Number(t) || _brush.thickness);
    if (_open) renderPanel();
    return { ok: true, thickness: _brush.thickness };
  }, 'Set the default brush thickness used by the next StrokeStart.');

  reg('__studioGPBrushSetColor', (c) => {
    _brush.color = String(c || _brush.color);
    if (_open) renderPanel();
    return { ok: true, color: _brush.color };
  }, 'Set the default brush colour used by the next StrokeStart.');

  reg('__studioGPBrushGet', () => ({ ok: true, thickness: _brush.thickness, color: _brush.color }),
    'Read the current brush thickness + colour.');

  // ── Transport ───────────────────────────────────────────────────────
  reg('__studioGPPlay', () => {
    const r = pbPlay();
    if (_open) { renderPanel(); pumpRender(); }
    return r;
  }, 'Start GP timeline playback.');

  reg('__studioGPPause', () => {
    const r = pbPause();
    if (_open) renderPanel();
    return r;
  }, 'Pause GP timeline playback.');

  reg('__studioGPSetTime', (t) => {
    const r = pbSetTime(t);
    if (_open) renderPanel();
    return r;
  }, 'Scrub the GP timeline cursor to a specific second.');

  reg('__studioGPGetState', () => ({ ok: true, ...pbGetState(), strokes: _strokes.size, layers: listLayers().count }),
    'Read GP timeline state (playing/time/duration + counts).');

  reg('__studioGPSetDuration', (d) => setDuration(d),
    'Override the default GP timeline duration in seconds.');

  reg('__studioGPSetLoop', (on) => setLoop(on),
    'Toggle GP timeline loop-at-end behaviour.');

  // ── Panel ───────────────────────────────────────────────────────────
  reg('__studioGPPanelOpen', panelOpen, 'Open the Grease Pencil side panel.');
  reg('__studioGPPanelClose', panelClose, 'Close the Grease Pencil side panel.');
  reg('__studioGPPanelToggle', panelToggle, 'Toggle the Grease Pencil side panel.');

  // ── Reset / utilities ──────────────────────────────────────────────
  reg('__studioGPReset', () => {
    // Wipe every stroke mesh from the scene.
    for (const s of _strokes.values()) disposeStroke(s);
    _strokes.clear();
    resetLayers();
    pbReset();
    _currentDrawing = null;
    if (_open) renderPanel();
    return { ok: true };
  }, 'Reset every grease pencil layer, stroke, and timeline state.');

  // Best-effort tick install — viewport may not exist yet at install
  // time during dev-server cold start. ensureTick() is also called
  // again from play() so this isn't load-bearing.
  ensureTick();

  // Esc to close the panel.
  if (typeof window !== 'undefined') {
    const _onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if (e.key === 'Escape' && _open) { panelClose(); e.preventDefault(); }
    };
    window.addEventListener('keydown', _onKey);
  }

  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallGreasePencil() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  unregisterOps(OP_NAMES);
  if (_panel) { unmountPanel('gp'); _panel = null; }
  _open = false;
  for (const s of _strokes.values()) disposeStroke(s);
  _strokes.clear();
  resetLayers();
  _currentDrawing = null;
  _installed = false;
  // Don't reset playback tick — chain may be shared by other systems.
  return { ok: true };
}

// Re-export internals used by tests + the panel.
export {
  GP_USERDATA_FLAG,
  applyVisibility,
};
