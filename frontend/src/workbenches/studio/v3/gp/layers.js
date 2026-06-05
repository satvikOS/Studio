// ArchDisc Studio V3 — Grease Pencil layer + frame stack.
//
// A "layer" owns a Map of frames keyed by *scene time* (seconds). Each
// frame stores an ordered list of stroke uuids that should be visible
// when the timeline cursor is past that frame's time (but before the
// next frame on the same layer).
//
//   layer = {
//     uuid:    string                generated once
//     name:    string                display label
//     visible: boolean               eye toggle
//     opacity: number  [0..1]        master alpha for every stroke
//     frames:  Map<time:number, strokeUuid[]>
//   }
//
// The store is a single module-level array (`_layers`) + a pointer to
// the active layer. Mutators return small `{ ok, ... }` objects so the
// orchestrator can lift them straight onto window.__studioGP* without
// adapter boilerplate.
//
// Pure JS — no DOM, no THREE; the playback module owns the per-frame
// stroke-visibility plumbing. We just keep the data correct.

let _seq = 1;
function _uuid() {
  _seq += 1;
  return `gp-layer-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

const _layers = [];          // [{ uuid, name, visible, opacity, frames: Map }]
let _activeUuid = null;

// ─── Read API ────────────────────────────────────────────────────────

export function listLayers() {
  return {
    ok: true,
    count: _layers.length,
    activeUuid: _activeUuid,
    layers: _layers.map((l) => ({
      uuid: l.uuid,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      frameCount: l.frames.size,
      frameTimes: Array.from(l.frames.keys()).sort((a, b) => a - b),
    })),
  };
}

export function getLayer(uuid) {
  return _layers.find((l) => l.uuid === uuid) || null;
}

export function getActiveLayer() {
  if (!_activeUuid) return null;
  return getLayer(_activeUuid);
}

export function getActiveUuid() { return _activeUuid; }

export function allLayers() { return _layers.slice(); }

// ─── Mutators ────────────────────────────────────────────────────────

export function addLayer(name) {
  const layer = {
    uuid: _uuid(),
    name: String(name || `Layer ${_layers.length + 1}`),
    visible: true,
    opacity: 1,
    frames: new Map(),
  };
  // Seed every fresh layer with a frame at t=0 so the user can start
  // drawing immediately without a "no frame" gotcha — matches Blender's
  // automatic-keyframe-on-first-stroke behaviour.
  layer.frames.set(0, []);
  _layers.push(layer);
  if (!_activeUuid) _activeUuid = layer.uuid;
  return { ok: true, uuid: layer.uuid, name: layer.name, count: _layers.length };
}

export function setActive(uuid) {
  const l = getLayer(uuid);
  if (!l) return { ok: false, error: 'layer not found' };
  _activeUuid = l.uuid;
  return { ok: true, activeUuid: l.uuid };
}

export function toggleVisible(uuid, on) {
  const l = getLayer(uuid);
  if (!l) return { ok: false, error: 'layer not found' };
  l.visible = on == null ? !l.visible : !!on;
  return { ok: true, uuid: l.uuid, visible: l.visible };
}

export function setOpacity(uuid, w) {
  const l = getLayer(uuid);
  if (!l) return { ok: false, error: 'layer not found' };
  const v = Math.max(0, Math.min(1, Number(w) || 0));
  l.opacity = v;
  return { ok: true, uuid: l.uuid, opacity: l.opacity };
}

export function deleteLayer(uuid) {
  const i = _layers.findIndex((l) => l.uuid === uuid);
  if (i < 0) return { ok: false, error: 'layer not found' };
  _layers.splice(i, 1);
  if (_activeUuid === uuid) {
    _activeUuid = _layers.length ? _layers[_layers.length - 1].uuid : null;
  }
  return { ok: true, removed: uuid, remaining: _layers.length };
}

// ─── Frames ──────────────────────────────────────────────────────────

/**
 * Add (or pick up an existing) frame at the given time. Returns the
 * existing stroke list — useful for the caller who's about to append
 * a new stroke uuid.
 */
export function addFrame(layerUuid, time) {
  const l = getLayer(layerUuid);
  if (!l) return { ok: false, error: 'layer not found' };
  const t = _normTime(time);
  if (!l.frames.has(t)) l.frames.set(t, []);
  return { ok: true, time: t, strokes: l.frames.get(t).slice() };
}

export function deleteFrame(layerUuid, time) {
  const l = getLayer(layerUuid);
  if (!l) return { ok: false, error: 'layer not found' };
  const t = _normTime(time);
  const had = l.frames.delete(t);
  return { ok: true, removed: had, remaining: l.frames.size };
}

/**
 * Resolve the "current" frame on a layer for a given scene time `t`:
 * the frame whose time is the largest value ≤ t. Returns null when no
 * such frame exists (i.e. the layer's first frame is > t).
 *
 * This is the Blender-GP "hold-last-frame" semantics — the most recent
 * keyframe stays on screen until the next keyframe replaces it.
 */
export function frameAtTime(layer, t) {
  if (!layer || !(layer.frames instanceof Map) || !layer.frames.size) return null;
  const time = Number(t) || 0;
  let bestT = -Infinity;
  let bestStrokes = null;
  layer.frames.forEach((strokes, ft) => {
    if (ft <= time && ft > bestT) {
      bestT = ft;
      bestStrokes = strokes;
    }
  });
  if (bestStrokes == null) return null;
  return { time: bestT, strokes: bestStrokes };
}

/**
 * Append a stroke uuid to the active layer's current frame at scene
 * time `t`. Creates the frame if it doesn't exist. Returns the layer
 * and frame we wrote into so the orchestrator can report back.
 */
export function appendStrokeToActiveAt(time, strokeUuid) {
  const l = getActiveLayer();
  if (!l) return { ok: false, error: 'no active layer' };
  const t = _normTime(time);
  // Use the latest existing frame ≤ t if any, else create one.
  const cur = frameAtTime(l, t);
  let writeT;
  if (cur) {
    writeT = cur.time;
  } else {
    writeT = t;
    l.frames.set(writeT, []);
  }
  l.frames.get(writeT).push(strokeUuid);
  return { ok: true, layerUuid: l.uuid, time: writeT, strokes: l.frames.get(writeT).slice() };
}

/**
 * Remove a stroke uuid from every frame on every layer (called when a
 * stroke is deleted). Returns the number of frames it was removed from.
 */
export function detachStroke(strokeUuid) {
  let n = 0;
  for (const l of _layers) {
    l.frames.forEach((strokes, t) => {
      const i = strokes.indexOf(strokeUuid);
      if (i >= 0) { strokes.splice(i, 1); n += 1; }
    });
  }
  return n;
}

/**
 * Reset everything. Used by tests + the install-uninstall cycle.
 */
export function resetLayers() {
  _layers.length = 0;
  _activeUuid = null;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function _normTime(t) {
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return 0;
  // Snap to milliseconds so floating-point creep doesn't fragment the
  // Map into thousands of effectively-equal keys.
  return Math.round(n * 1000) / 1000;
}
