// ArchDisc Studio V3 — Non-Linear Animation strip stack.
//
// A "strip" wraps an existing animation curve (built by the bezier-graph
// editor in ../anim/) and gives it a *time window*, a *blend mode*, and
// a target property. Multiple strips can be stacked on the same target:
// each frame the stack is walked in insertion order (= priority) and
// each in-time strip contributes a value via its blend mode.
//
// Blend modes:
//   • replace — write the sampled value (overrides everything before)
//   • add     — sampledValue is added to the running value
//   • mul     — sampledValue is multiplied with the running value
//
// Strip data:
//   {
//     uuid              auto-generated
//     targetMeshUuid    where to write
//     property          'position.y' / 'rotation.z' / etc.
//     curveUuid         which animation curve to sample
//     startTime         strip starts at this timeline second
//     endTime           strip ends at this timeline second
//     scale             time-warp factor (1 = play at authored speed)
//     blend             'replace' | 'add' | 'mul'
//     enabled
//   }
//
// Per-frame logic for a given target (mesh.property):
//   value = read(target)
//   for strip in strips_for_target (ordered):
//     if !strip.enabled: continue
//     if t < strip.startTime || t > strip.endTime: continue
//     local = (t - strip.startTime) * strip.scale
//     sampled = sample(curve, local)
//     switch strip.blend:
//       replace → value = sampled
//       add     → value = value + sampled
//       mul     → value = value * sampled
//   write(target, value)
//
// The NLA writes happen AFTER drivers each frame so a driver can feed
// the NLA's base value and the NLA can layer on top. The tick guard for
// audit is `__animAdvNLA`.

import { sample as sampleCurve } from '../anim/curves.js';
import { getCurve } from '../anim/playback.js';

// ─── State ───────────────────────────────────────────────────────────
const _strips = [];        // ordered by insertion = priority
const _byUuid = new Map(); // uuid → strip ref into _strips
let _seq = 1;
function _uuid() {
  _seq += 1;
  return `animadv-nla-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

const _CHAN = { x: 0, y: 1, z: 2 };
const _CHAN_NAMES = ['x', 'y', 'z'];

function _parsePath(path) {
  if (!path || typeof path !== 'string') return null;
  const dot = path.indexOf('.');
  if (dot < 0) return null;
  const prop = path.slice(0, dot);
  const chRaw = path.slice(dot + 1);
  if (prop !== 'position' && prop !== 'rotation' && prop !== 'scale') return null;
  const ch = _CHAN[chRaw];
  if (ch === undefined) return null;
  return { property: prop, channel: ch };
}

function _resolveMesh(uuid) {
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

function _read(mesh, prop, channel) {
  if (!mesh) return 0;
  const ch = _CHAN_NAMES[channel] || 'x';
  if (prop === 'position' && mesh.position) return mesh.position[ch];
  if (prop === 'scale' && mesh.scale) return mesh.scale[ch];
  if (prop === 'rotation' && mesh.rotation) return mesh.rotation[ch];
  return 0;
}

function _write(mesh, prop, channel, value) {
  if (!mesh) return false;
  const ch = _CHAN_NAMES[channel] || 'x';
  if (prop === 'position' && mesh.position) { mesh.position[ch] = value; return true; }
  if (prop === 'scale' && mesh.scale) { mesh.scale[ch] = value; return true; }
  if (prop === 'rotation' && mesh.rotation) { mesh.rotation[ch] = value; return true; }
  return false;
}

// ─── Registry ────────────────────────────────────────────────────────

/**
 * Add a strip. Validates path + curve existence up-front so a bad
 * call returns { ok: false } instead of failing silently mid-tick.
 *
 * opts: { scale?: number, blend?: 'replace'|'add'|'mul', enabled?: bool }
 */
export function addStrip(targetMeshUuid, property, curveUuid, startTime, endTime, opts) {
  const path = _parsePath(property);
  if (!path) return { ok: false, error: 'bad property path' };
  const curve = getCurve(curveUuid);
  if (!curve) return { ok: false, error: 'curve not found' };
  const s = Number(startTime) || 0;
  let e = Number(endTime);
  if (!Number.isFinite(e) || e <= s) e = s + 1;
  const o = opts || {};
  const blend = (o.blend === 'add' || o.blend === 'mul') ? o.blend : 'replace';
  const strip = {
    uuid: _uuid(),
    targetMeshUuid: String(targetMeshUuid || ''),
    property: String(property),
    prop: path.property,
    channel: path.channel,
    curveUuid: String(curveUuid),
    startTime: s,
    endTime: e,
    scale: Number.isFinite(o.scale) && o.scale > 0 ? Number(o.scale) : 1,
    blend,
    enabled: o.enabled !== false,
  };
  _strips.push(strip);
  _byUuid.set(strip.uuid, strip);
  return { ok: true, uuid: strip.uuid };
}

export function deleteStrip(uuid) {
  const s = _byUuid.get(uuid);
  if (!s) return { ok: false };
  const i = _strips.indexOf(s);
  if (i >= 0) _strips.splice(i, 1);
  _byUuid.delete(uuid);
  return { ok: true };
}

export function listStrips() {
  return _strips.map((s) => ({
    uuid: s.uuid,
    targetMeshUuid: s.targetMeshUuid,
    property: s.property,
    curveUuid: s.curveUuid,
    startTime: s.startTime,
    endTime: s.endTime,
    duration: s.endTime - s.startTime,
    scale: s.scale,
    blend: s.blend,
    enabled: s.enabled,
  }));
}

export function getStrip(uuid) {
  return _byUuid.get(uuid) || null;
}

export function setStripBlend(uuid, blend) {
  const s = _byUuid.get(uuid);
  if (!s) return { ok: false };
  if (blend !== 'replace' && blend !== 'add' && blend !== 'mul') {
    return { ok: false, error: 'bad blend' };
  }
  s.blend = blend;
  return { ok: true, blend };
}

export function setStripTime(uuid, start, end) {
  const s = _byUuid.get(uuid);
  if (!s) return { ok: false };
  if (Number.isFinite(start)) s.startTime = Number(start);
  if (Number.isFinite(end)) s.endTime = Number(end);
  if (s.endTime <= s.startTime) s.endTime = s.startTime + 0.01;
  return { ok: true, start: s.startTime, end: s.endTime };
}

export function setStripScale(uuid, scale) {
  const s = _byUuid.get(uuid);
  if (!s) return { ok: false };
  s.scale = Number.isFinite(scale) && scale > 0 ? Number(scale) : 1;
  return { ok: true, scale: s.scale };
}

export function setStripEnabled(uuid, on) {
  const s = _byUuid.get(uuid);
  if (!s) return { ok: false };
  s.enabled = !!on;
  return { ok: true, enabled: s.enabled };
}

export function clearStrips() {
  _strips.length = 0;
  _byUuid.clear();
}

export function stripCount() { return _strips.length; }

// ─── Per-target grouping ─────────────────────────────────────────────
/**
 * Build a Map<meshUuid + '|' + property, strip[]> so applyAll can run
 * the blend stack once per (target, property) pair. Insertion order is
 * preserved — JS Maps + array push handle priority for free.
 */
function _groupByTarget() {
  const groups = new Map();
  for (const s of _strips) {
    const key = `${s.targetMeshUuid}|${s.property}`;
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push(s);
  }
  return groups;
}

/**
 * Walk every (target, property) group and write the blended result at
 * the given timeline second. Returns the number of writes performed.
 */
export function applyAllStrips(time) {
  let n = 0;
  const t = Number.isFinite(time) ? time : 0;
  const groups = _groupByTarget();
  groups.forEach((strips, key) => {
    if (!strips.length) return;
    const first = strips[0];
    const mesh = _resolveMesh(first.targetMeshUuid);
    if (!mesh) return;
    // Start from the current property value so an empty stack writes
    // a no-op and a 'replace' inside the window overrides cleanly.
    let value = _read(mesh, first.prop, first.channel);
    let touched = false;
    for (const s of strips) {
      if (!s.enabled) continue;
      if (t < s.startTime || t > s.endTime) continue;
      const curve = getCurve(s.curveUuid);
      if (!curve) continue;
      const local = (t - s.startTime) * (s.scale || 1);
      const sampled = sampleCurve(curve, local);
      if (s.blend === 'add') value = value + sampled;
      else if (s.blend === 'mul') value = value * sampled;
      else value = sampled;
      touched = true;
    }
    if (touched) {
      _write(mesh, first.prop, first.channel, value);
      n += 1;
    }
  });
  return n;
}

// ─── Tick install ────────────────────────────────────────────────────
let _tickInstalled = false;

export function installNLATick() {
  if (typeof window === 'undefined') return false;
  const v = window.__archdiscViewport;
  if (!v) return false;
  if (v.__studioAnimTick && v.__studioAnimTick.__animAdvNLA) {
    _tickInstalled = true;
    return true;
  }
  const prev = v.__studioAnimTick;
  const fn = (now) => {
    const tSec = (typeof now === 'number' ? now : 0) / 1000;
    try { applyAllStrips(tSec); } catch (_) { /* swallow */ }
    if (prev) {
      try { prev(now); } catch (_) { /* swallow */ }
    }
  };
  fn.__animAdvNLA = true;
  fn.__prev = prev;
  v.__studioAnimTick = fn;
  _tickInstalled = true;
  return true;
}

export function uninstallNLATick() {
  if (typeof window === 'undefined') return false;
  const v = window.__archdiscViewport;
  if (!v) return false;
  if (v.__studioAnimTick && v.__studioAnimTick.__animAdvNLA) {
    v.__studioAnimTick = v.__studioAnimTick.__prev || null;
    _tickInstalled = false;
    return true;
  }
  let head = v.__studioAnimTick;
  while (head && head.__prev) {
    if (head.__prev.__animAdvNLA) {
      head.__prev = head.__prev.__prev || null;
      _tickInstalled = false;
      return true;
    }
    head = head.__prev;
  }
  return false;
}

export function isNLATickInstalled() { return _tickInstalled; }
