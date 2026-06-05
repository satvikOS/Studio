// ArchDisc Studio V3 — audio playback transport.
//
// Per-uuid state on top of the shared AudioContext from load.js:
//
//   _states: Map<uuid, {
//     source     : AudioBufferSourceNode | null   one-shot, recreated on play
//     gain       : GainNode                       volume + master mute point
//     volume     : number                          0..1
//     playing    : boolean
//     startedAt  : number                          ctx.currentTime when source.start fired
//     offset     : number                          seconds within the buffer when we started
//     pausedAt   : number                          last position (s) at pause()
//   }>
//
// `play(uuid, atTime)` builds a fresh AudioBufferSourceNode (they're
// one-shot per the Web Audio spec), wires it gain → destination, and
// remembers the `(startedAt, offset)` pair so `getCurrentTime` can
// compute the elapsed position any time later as `(ctx.now -
// startedAt) + offset`, clamped to the buffer duration. `pause` stops
// the node and rewrites `pausedAt`, so a subsequent `play` resumes from
// the same spot.
//
// Animation-sync hook: `installAnimSync()` wraps the existing
// `window.__studioPlayAnimation` / `__studioPauseAnimation` so calling
// them auto-plays/pauses all currently-loaded audio from t=0. The wrap
// is idempotent and remembers it has wrapped via a `__studioAudioWrap`
// flag so we don't double-chain on re-installs.

import { getAudioContext, getBuffer, getEntry, getAll } from './load.js';

// ─── Per-uuid playback state ─────────────────────────────────────────
const _states = new Map();

function getOrCreateState(uuid) {
  let s = _states.get(uuid);
  if (s) return s;
  const ctx = getAudioContext();
  if (!ctx) return null;
  let gain = null;
  try {
    gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(ctx.destination);
  } catch (_) {
    gain = null;
  }
  s = {
    source: null,
    gain,
    volume: 1,
    playing: false,
    startedAt: 0,
    offset: 0,
    pausedAt: 0,
  };
  _states.set(uuid, s);
  return s;
}

function stopSource(state) {
  if (!state || !state.source) return;
  try {
    state.source.onended = null;
    state.source.stop(0);
  } catch (_) { /* already stopped */ }
  try { state.source.disconnect(); } catch (_) {}
  state.source = null;
}

// ─── Transport ───────────────────────────────────────────────────────
/**
 * Play `uuid` from `atTime` seconds (defaults to 0 the first time, or
 * the paused position on subsequent calls). Returns `{ ok, time }`
 * where `time` is the offset playback actually started from.
 */
export function play(uuid, atTime) {
  const buffer = getBuffer(uuid);
  if (!buffer) return { ok: false, error: 'unknown audio uuid' };
  const ctx = getAudioContext();
  if (!ctx) return { ok: false, error: 'no AudioContext' };
  const state = getOrCreateState(uuid);
  if (!state || !state.gain) return { ok: false, error: 'no gain node' };
  // Auto-resume the context on user gestures — Chrome/Edge auto-suspend
  // on page load and we won't hear anything until resume() succeeds.
  if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
    try { ctx.resume(); } catch (_) {}
  }
  // If we were already playing, tear the existing node down first.
  stopSource(state);
  const dur = buffer.duration;
  let off;
  if (typeof atTime === 'number' && !Number.isNaN(atTime)) {
    off = Math.max(0, Math.min(dur, atTime));
  } else if (state.pausedAt > 0 && state.pausedAt < dur - 1e-3) {
    off = state.pausedAt;
  } else {
    off = 0;
  }
  let source;
  try {
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(state.gain);
    source.onended = () => {
      // The end callback fires for both natural completion AND our own
      // .stop(0) calls in stopSource — guard via state.source identity
      // so a pause() doesn't accidentally trip the auto-reset branch.
      if (state.source === source) {
        state.playing = false;
        state.source = null;
        state.pausedAt = 0;
      }
    };
    source.start(0, off);
  } catch (e) {
    return { ok: false, error: 'play failed: ' + String((e && e.message) || e) };
  }
  state.source = source;
  state.playing = true;
  state.startedAt = ctx.currentTime;
  state.offset = off;
  state.pausedAt = off;
  return { ok: true, time: off, duration: dur };
}

export function pause(uuid) {
  const state = _states.get(uuid);
  if (!state) return { ok: false, error: 'not playing' };
  const buffer = getBuffer(uuid);
  if (!buffer) return { ok: false, error: 'unknown audio uuid' };
  if (!state.playing) {
    return { ok: true, time: state.pausedAt, playing: false };
  }
  const ctx = getAudioContext();
  const elapsed = ctx ? Math.max(0, ctx.currentTime - state.startedAt) : 0;
  const pos = Math.max(0, Math.min(buffer.duration, state.offset + elapsed));
  stopSource(state);
  state.playing = false;
  state.pausedAt = pos;
  return { ok: true, time: pos, playing: false };
}

export function stop(uuid) {
  const state = _states.get(uuid);
  if (!state) return { ok: false, error: 'unknown' };
  stopSource(state);
  state.playing = false;
  state.startedAt = 0;
  state.offset = 0;
  state.pausedAt = 0;
  return { ok: true, time: 0, playing: false };
}

export function getCurrentTime(uuid) {
  const state = _states.get(uuid);
  if (!state) return 0;
  if (!state.playing) return state.pausedAt;
  const ctx = getAudioContext();
  if (!ctx) return state.pausedAt;
  const buffer = getBuffer(uuid);
  const dur = buffer ? buffer.duration : Infinity;
  return Math.max(0, Math.min(dur, state.offset + (ctx.currentTime - state.startedAt)));
}

export function setVolume(uuid, v) {
  const state = getOrCreateState(uuid);
  if (!state) return { ok: false, error: 'no state' };
  const vol = Math.max(0, Math.min(1, Number(v)));
  state.volume = vol;
  if (state.gain) {
    try {
      // setValueAtTime avoids glitchy ramps if v changes rapidly.
      const ctx = getAudioContext();
      if (ctx) state.gain.gain.setValueAtTime(vol, ctx.currentTime);
      else state.gain.gain.value = vol;
    } catch (_) {
      state.gain.gain.value = vol;
    }
  }
  return { ok: true, volume: vol };
}

export function getVolume(uuid) {
  const state = _states.get(uuid);
  return state ? state.volume : 1;
}

export function isPlaying(uuid) {
  const s = _states.get(uuid);
  return !!(s && s.playing);
}

export function destroyState(uuid) {
  const state = _states.get(uuid);
  if (!state) return false;
  stopSource(state);
  if (state.gain) {
    try { state.gain.disconnect(); } catch (_) {}
  }
  _states.delete(uuid);
  return true;
}

export function listPlaybackStates() {
  const out = [];
  _states.forEach((s, uuid) => {
    const e = getEntry(uuid);
    out.push({
      uuid,
      playing: s.playing,
      volume: s.volume,
      currentTime: getCurrentTime(uuid),
      duration: e && e.buffer ? e.buffer.duration : 0,
      name: e ? e.name : '',
    });
  });
  return out;
}

// ─── Animation sync ──────────────────────────────────────────────────
// Wrap __studioPlayAnimation / __studioPauseAnimation so the audio
// transport stays glued to whatever the animation system is doing.
let _syncInstalled = false;

export function installAnimSync() {
  if (typeof window === 'undefined') return false;
  if (_syncInstalled) return true;
  _syncInstalled = true;

  // We re-check on each invocation rather than at install time because
  // api.js may load *after* us in some boot orders. Storing the wrap
  // flag on the bound fn itself prevents a re-wrap if another agent
  // calls installAnimSync() a second time.
  const playOrig = window.__studioPlayAnimation;
  if (typeof playOrig === 'function' && !playOrig.__studioAudioWrap) {
    const wrapped = function audioSyncedPlay(duration) {
      const r = playOrig.apply(this, arguments);
      try {
        getAll().forEach((_, uuid) => {
          // Play from t=0 to mirror the AnimationAction.play() restart.
          play(uuid, 0);
        });
      } catch (_) { /* swallow — animation must keep running */ }
      return r;
    };
    wrapped.__studioAudioWrap = true;
    wrapped.__orig = playOrig;
    window.__studioPlayAnimation = wrapped;
  }
  const pauseOrig = window.__studioPauseAnimation;
  if (typeof pauseOrig === 'function' && !pauseOrig.__studioAudioWrap) {
    const wrapped = function audioSyncedPause() {
      const r = pauseOrig.apply(this, arguments);
      try {
        getAll().forEach((_, uuid) => { pause(uuid); });
      } catch (_) {}
      return r;
    };
    wrapped.__studioAudioWrap = true;
    wrapped.__orig = pauseOrig;
    window.__studioPauseAnimation = wrapped;
  }
  return true;
}

export function uninstallAnimSync() {
  if (typeof window === 'undefined') return false;
  for (const k of ['__studioPlayAnimation', '__studioPauseAnimation']) {
    const fn = window[k];
    if (fn && fn.__studioAudioWrap && fn.__orig) {
      window[k] = fn.__orig;
    }
  }
  _syncInstalled = false;
  return true;
}
