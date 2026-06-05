// ArchDisc Studio V3 — animation curve playback driver.
//
// One module-level state object owns the "global" timeline cursor
// (current time + playing flag + a Map<curveUuid, curve> store), plus
// the chained tick function installed on
// `window.__archdiscViewport.__studioAnimTick`.
//
// Ticking pattern (matches V3 conventions — wind / fps / physics all
// chain the previous tick the same way):
//
//   const prev = v.__studioAnimTick;
//   const fn = (now) => {
//     // ...drive curves...
//     if (prev) prev(now);
//   };
//   fn.__animGraph = true;
//   fn.__prev = prev;
//   v.__studioAnimTick = fn;
//
// On every frame we resolve each curve back to its target mesh, look
// up the value for `state.time`, and write it into mesh.position[.x|.y
// |.z] / mesh.rotation / mesh.scale. Rotation curves treat the channel
// as an Euler component in radians; quaternion authoring isn't yet
// surfaced here (the slice 629 system handles that, see api.js).
//
// Coexists with __studioKeyframe* by writing under its OWN tick guard
// (`__animGraph` flag) so a future tick-chain audit can tell the two
// pipelines apart.

import { sample } from './curves.js';

// ─── Module-level state ──────────────────────────────────────────────
const state = {
  curves: new Map(),       // uuid → curve
  playing: false,
  time: 0,                 // seconds
  lastTickMs: 0,           // perf.now() at the last tick
  tickInstalled: false,
};

export function getStore() { return state; }
export function getCurves() { return state.curves; }

// ─── Curve registry ──────────────────────────────────────────────────
export function registerCurve(curve) {
  if (!curve || !curve.uuid) return false;
  state.curves.set(curve.uuid, curve);
  return true;
}
export function unregisterCurve(uuid) {
  return state.curves.delete(uuid);
}
export function getCurve(uuid) { return state.curves.get(uuid) || null; }

export function curveCount() { return state.curves.size; }

/**
 * Duration of the longest curve, used as the global timeline length.
 */
export function timelineDuration() {
  let d = 0;
  state.curves.forEach((c) => {
    if (c.keys && c.keys.length) {
      const last = c.keys[c.keys.length - 1].time;
      if (last > d) d = last;
    }
  });
  return d;
}

// ─── Mesh lookup (works in tests + live viewport alike) ───────────────
function resolveMesh(uuid) {
  if (typeof window === 'undefined') return null;
  const scene = window.__archdiscScene;
  if (scene && typeof scene.getObjectByProperty === 'function') {
    const m = scene.getObjectByProperty('uuid', uuid);
    if (m) return m;
  }
  const vp = window.__archdiscViewport;
  if (vp && vp.scene && typeof vp.scene.getObjectByProperty === 'function') {
    const m = vp.scene.getObjectByProperty('uuid', uuid);
    if (m) return m;
  }
  return null;
}

const _CHAN = ['x', 'y', 'z'];

/**
 * Apply a single curve's current value into its target object3d.
 * Pure function: takes the curve + a node + a time and writes back.
 * Returns true if a write happened (curve had keys + valid target).
 */
export function applyCurveToNode(curve, node, t) {
  if (!curve || !node) return false;
  if (!curve.keys || !curve.keys.length) return false;
  const v = sample(curve, t);
  const channel = _CHAN[Math.max(0, Math.min(2, Number(curve.channel) || 0))];
  const property = curve.property;
  if (property === 'position' && node.position) {
    node.position[channel] = v;
    return true;
  }
  if (property === 'scale' && node.scale) {
    node.scale[channel] = v;
    return true;
  }
  if (property === 'rotation' && node.rotation) {
    node.rotation[channel] = v;
    return true;
  }
  return false;
}

/**
 * Sweep every registered curve at time `t`. Looks up the target mesh
 * by uuid; missing meshes (deleted between auth and play) are simply
 * skipped — no error, no console spam.
 */
export function applyAllAtTime(t) {
  let n = 0;
  state.curves.forEach((c) => {
    const node = resolveMesh(c.meshUuid);
    if (!node) return;
    if (applyCurveToNode(c, node, t)) n += 1;
  });
  return n;
}

// ─── Tick install / uninstall ────────────────────────────────────────
function _installTick() {
  if (typeof window === 'undefined') return false;
  const v = window.__archdiscViewport;
  if (!v) return false;
  // Idempotent — bail if our function is already in the chain.
  if (v.__studioAnimTick && v.__studioAnimTick.__animGraph) return true;
  const prev = v.__studioAnimTick;
  const fn = (now) => {
    // dt smoothed against a 100 ms cap so a frozen tab + a wake-up
    // doesn't fast-forward the timeline by minutes in one frame.
    if (state.playing) {
      const last = state.lastTickMs || now;
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      state.lastTickMs = now;
      state.time += dt;
      const dur = timelineDuration();
      if (dur > 0 && state.time > dur) {
        // Loop around — matches the slice 629 behaviour of
        // AnimationAction.setLoop(THREE.LoopRepeat).
        state.time = state.time % dur;
      }
      applyAllAtTime(state.time);
    }
    if (prev) {
      try { prev(now); } catch (_) { /* swallow tick chain errors */ }
    }
  };
  fn.__animGraph = true;
  fn.__prev = prev;
  v.__studioAnimTick = fn;
  state.tickInstalled = true;
  return true;
}

/**
 * Ensure the tick chain has our function. Call this once per page-load
 * (the install module does), and again from play() so a late viewport
 * mount still wires up.
 */
export function ensureTick() {
  return _installTick();
}

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
  const dur = timelineDuration();
  const tt = Math.max(0, Number(t) || 0);
  state.time = dur > 0 ? Math.min(dur, tt) : tt;
  // Immediately apply so the viewport reflects the scrub. No raf wait.
  applyAllAtTime(state.time);
  return { ok: true, time: state.time };
}

export function getState() {
  const list = [];
  state.curves.forEach((c) => {
    list.push({
      uuid: c.uuid, meshUuid: c.meshUuid,
      property: c.property, channel: c.channel,
      keyCount: c.keys.length,
    });
  });
  return {
    playing: state.playing,
    time: state.time,
    duration: timelineDuration(),
    curves: list,
  };
}

export function reset() {
  state.curves.clear();
  state.playing = false;
  state.time = 0;
  state.lastTickMs = 0;
}
