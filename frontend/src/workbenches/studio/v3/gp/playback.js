// ArchDisc Studio V3 — Grease Pencil playback / per-frame visibility.
//
// One module-level state object owns the "global" GP timeline cursor
// (current time + playing flag), plus the chained tick function
// installed on `window.__archdiscViewport.__studioAnimTick`. We follow
// the same chaining convention as v3/anim/playback.js (wind, fps,
// constraints, anim graph all queue up on this single tick chain):
//
//   const prev = v.__studioAnimTick;
//   const fn = (now) => {
//     // ...drive GP visibility...
//     if (prev) prev(now);
//   };
//   fn.__gp = true;
//   fn.__prev = prev;
//   v.__studioAnimTick = fn;
//
// On every frame we walk every layer, resolve its active frame (the
// last one whose time ≤ state.time), and toggle the visibility of
// each stroke's mesh accordingly. Layer-opacity is applied to the
// stroke material's `opacity` field; meshes whose containing frame is
// not the active one are hidden by setting `visible = false`.
//
// Pure JS — no React, no DOM mutations. The layer + stroke registries
// are passed in via `attach()` so this module stays decoupled from
// the orchestrator.

import { allLayers, frameAtTime } from './layers.js';

// ─── Module-level state ──────────────────────────────────────────────
const state = {
  playing: false,
  time: 0,                       // seconds
  lastTickMs: 0,                 // perf.now() at the last tick
  tickInstalled: false,
  duration: 4,                   // default playback window length
  loop: true,
};

let _strokeLookup = () => null;  // (uuid) -> stroke or null

export function attach({ getStroke }) {
  if (typeof getStroke === 'function') _strokeLookup = getStroke;
}

export function getStore() { return state; }

// ─── Visibility sweep ────────────────────────────────────────────────

/**
 * Apply the timeline cursor to every layer's strokes:
 *   - Strokes belonging to the active frame on a visible layer →
 *     `mesh.visible = true`, material opacity = layer.opacity * stroke.hardness.
 *   - Every other stroke that's a member of any layer/frame → hidden.
 *
 * Strokes not currently tied to a layer (e.g. just finalized but not
 * yet bound to a frame) are left untouched — the caller controls them.
 *
 * Returns a small diagnostic blob useful for tests + the side panel.
 */
export function applyVisibility(t) {
  const tt = Number(t);
  const time = Number.isFinite(tt) ? tt : state.time;
  const layers = allLayers();
  let totalVisible = 0;
  let totalHidden = 0;

  // First, build a set of every stroke uuid that BELONGS to any layer
  // so we can hide the "managed" ones not on the active frame, while
  // ignoring stray strokes the user may be authoring outside a layer.
  const managed = new Set();
  const activeStrokes = new Set();
  for (const layer of layers) {
    layer.frames.forEach((list) => { for (const u of list) managed.add(u); });
    if (!layer.visible) continue;
    const frame = frameAtTime(layer, time);
    if (!frame) continue;
    for (const u of frame.strokes) {
      activeStrokes.add(u);
    }
  }

  // Apply.
  for (const uuid of managed) {
    const stroke = _strokeLookup(uuid);
    if (!stroke || !stroke.mesh) continue;
    const showIt = activeStrokes.has(uuid);
    stroke.mesh.visible = showIt;
    // Push the layer's master opacity into the material when it's
    // visible. (We pick the FIRST visible layer that owns this stroke
    // — strokes shouldn't normally belong to more than one layer.)
    if (showIt && stroke.mesh.material) {
      let layerOpacity = 1;
      for (const layer of layers) {
        let found = false;
        layer.frames.forEach((list) => { if (list.indexOf(uuid) >= 0) found = true; });
        if (found) { layerOpacity = layer.opacity; break; }
      }
      const combined = Math.max(0, Math.min(1, layerOpacity * stroke.hardness));
      stroke.mesh.material.transparent = combined < 1;
      stroke.mesh.material.opacity = combined;
    }
    if (showIt) totalVisible += 1; else totalHidden += 1;
  }

  return { ok: true, time, visible: totalVisible, hidden: totalHidden };
}

// ─── Tick install / chain ────────────────────────────────────────────

function _installTick() {
  if (typeof window === 'undefined') return false;
  const v = window.__archdiscViewport;
  if (!v) return false;
  if (v.__studioAnimTick && v.__studioAnimTick.__gp) return true;
  const prev = v.__studioAnimTick;
  const fn = (now) => {
    if (state.playing) {
      const last = state.lastTickMs || now;
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      state.lastTickMs = now;
      state.time += dt;
      const dur = _effectiveDuration();
      if (dur > 0 && state.time > dur) {
        if (state.loop) state.time = state.time % dur;
        else { state.time = dur; state.playing = false; }
      }
      applyVisibility(state.time);
    }
    if (prev) {
      try { prev(now); } catch (_) { /* swallow tick chain errors */ }
    }
  };
  fn.__gp = true;
  fn.__prev = prev;
  v.__studioAnimTick = fn;
  state.tickInstalled = true;
  return true;
}

export function ensureTick() { return _installTick(); }

// ─── Transport ───────────────────────────────────────────────────────

export function play() {
  ensureTick();
  state.playing = true;
  state.lastTickMs = (typeof performance !== 'undefined') ? performance.now() : 0;
  return { ok: true, playing: true, time: state.time };
}

export function pause() {
  state.playing = false;
  return { ok: true, playing: false, time: state.time };
}

export function setTime(t) {
  const tt = Math.max(0, Number(t) || 0);
  state.time = tt;
  applyVisibility(state.time);
  return { ok: true, time: state.time };
}

export function setDuration(d) {
  const v = Math.max(0.001, Number(d) || 0);
  state.duration = v;
  return { ok: true, duration: state.duration };
}

export function setLoop(on) {
  state.loop = !!on;
  return { ok: true, loop: state.loop };
}

export function getState() {
  return {
    playing: state.playing,
    time: state.time,
    duration: _effectiveDuration(),
    loop: state.loop,
  };
}

export function reset() {
  state.playing = false;
  state.time = 0;
  state.lastTickMs = 0;
  state.duration = 4;
  state.loop = true;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Effective playback duration = max(default duration, latest frame
 * time across every layer). Empty timelines fall back to the static
 * default so the play button does *something* on a brand-new doc.
 */
function _effectiveDuration() {
  let d = state.duration;
  for (const layer of allLayers()) {
    layer.frames.forEach((_strokes, ft) => { if (ft > d) d = ft; });
  }
  return d;
}
