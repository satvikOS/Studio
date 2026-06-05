// ArchDisc Studio V3 — VSE timeline state.
//
// Owns the strip Map keyed by uuid + a transport (playhead time,
// playing flag, speed). Pure state; rendering lives in compose.js
// and the React editor.
//
// The transport is a simple RAF loop installed by ensureTick(); it
// integrates dt × speed into _time while playing. Compose isn't run
// from here — the editor's render loop drives that, and headless
// scrub callers go straight through compose.composeAt().

import { createStrip, sanitizeParams, mergeParams, stripToJSON, stripFromJSON, isActiveAt } from './strips.js';

const _strips = new Map();          // uuid → strip
let _time = 0;                      // current scrub time, seconds
let _playing = false;
let _speed = 1.0;
let _raf = 0;
let _lastTs = 0;
let _onTickHooks = [];              // editor + tests can subscribe

export function listStrips() {
  return Array.from(_strips.values());
}

export function getStrip(uuid) {
  return _strips.get(uuid) || null;
}

export function addStrip(kind, channel, startTime, endTime, params) {
  const s = createStrip(kind, channel, startTime, endTime, params);
  _strips.set(s.uuid, s);
  return s;
}

export function removeStrip(uuid) {
  return _strips.delete(uuid);
}

export function setStripTime(uuid, startTime, endTime) {
  const s = _strips.get(uuid);
  if (!s) return false;
  let st = Number(startTime);
  let en = Number(endTime);
  if (!Number.isFinite(st)) st = s.startTime;
  if (!Number.isFinite(en)) en = s.endTime;
  if (en < st) { const t = st; st = en; en = t; }
  s.startTime = st;
  s.endTime = en;
  return true;
}

export function setStripChannel(uuid, channel) {
  const s = _strips.get(uuid);
  if (!s) return false;
  s.channel = Math.max(1, Math.floor(Number(channel) || 1));
  return true;
}

export function setStripParams(uuid, params) {
  const s = _strips.get(uuid);
  if (!s) return false;
  mergeParams(s, params || {});
  return true;
}

// Active strips at time t, sorted channel ascending (so compose can
// paint bottom-up).
export function activeAt(t) {
  const hits = [];
  for (const s of _strips.values()) if (isActiveAt(s, t)) hits.push(s);
  hits.sort((a, b) => a.channel - b.channel);
  return hits;
}

// Last endTime across every strip — drives the editor's ruler width.
export function timelineDuration() {
  let m = 0;
  for (const s of _strips.values()) if (s.endTime > m) m = s.endTime;
  return m;
}

// ─── Transport ──────────────────────────────────────────────────────

export function getTime() { return _time; }

export function setTime(t) {
  const n = Number(t);
  if (Number.isFinite(n)) _time = Math.max(0, n);
  return _time;
}

export function play() {
  _playing = true;
  _lastTs = 0;
  ensureTick();
  return { ok: true, playing: true };
}

export function pause() {
  _playing = false;
  return { ok: true, playing: false };
}

export function isPlaying() { return _playing; }

export function setSpeed(s) {
  const v = Number(s);
  if (Number.isFinite(v) && v > 0) _speed = v;
  return _speed;
}

export function getSpeed() { return _speed; }

export function getState() {
  return {
    time: _time,
    playing: _playing,
    speed: _speed,
    duration: timelineDuration(),
    count: _strips.size,
  };
}

export function onTick(fn) {
  if (typeof fn === 'function') _onTickHooks.push(fn);
  return () => { _onTickHooks = _onTickHooks.filter((f) => f !== fn); };
}

export function ensureTick() {
  if (typeof window === 'undefined') return;
  if (_raf) return;
  const step = (ts) => {
    if (_playing) {
      if (_lastTs) {
        const dt = (ts - _lastTs) / 1000;
        _time = Math.max(0, _time + dt * _speed);
        // Optional auto-loop — for now we just let time grow; the
        // editor's scrub bar clips visually.
      }
      _lastTs = ts;
      for (const h of _onTickHooks) {
        try { h(_time); } catch (_) { /* swallow */ }
      }
    } else {
      _lastTs = 0;
    }
    _raf = requestAnimationFrame(step);
  };
  _raf = requestAnimationFrame(step);
}

export function reset() {
  _strips.clear();
  _time = 0;
  _playing = false;
  _speed = 1.0;
}

// ─── Persistence ────────────────────────────────────────────────────

export function toJSON() {
  return {
    version: 1,
    time: _time,
    speed: _speed,
    strips: Array.from(_strips.values()).map(stripToJSON),
  };
}

export function fromJSON(json) {
  _strips.clear();
  if (!json) return;
  if (Array.isArray(json.strips)) {
    for (const s of json.strips) {
      const r = stripFromJSON(s);
      if (r) _strips.set(r.uuid, r);
    }
  }
  if (Number.isFinite(+json.time)) _time = Math.max(0, +json.time);
  if (Number.isFinite(+json.speed) && +json.speed > 0) _speed = +json.speed;
}

// Re-export sanitizeParams for the install layer convenience.
export { sanitizeParams };
