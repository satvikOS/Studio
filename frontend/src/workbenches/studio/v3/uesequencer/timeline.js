// Slice 699 — Unreal-Sequencer-style master timeline: multi-track
// key-framed editor for arbitrary mesh properties + camera + lights.
// Distinct from slice-686 anim (Blender Graph Editor) — Sequencer is
// the cinematic master clock; multiple "spawnable" + "possessable"
// tracks; per-frame composition over time.

const _state = {
  tracks: [],            // [{ uuid, kind, targetUuid, property, keys: [{frame, value}], color }]
  currentFrame: 0,
  startFrame: 0,
  endFrame: 240,
  fps: 24,
  playing: false,
  lastTickMs: 0,
};

let _seq = 1;
function _uuid() { return `seq-${_seq++}-${Date.now().toString(36)}`; }

export function getState() { return _state; }

export function addTrack(kind, targetUuid, property, opts) {
  const track = {
    uuid: _uuid(),
    kind: kind || 'transform',
    targetUuid: targetUuid || null,
    property: property || '.position.y',
    keys: [],
    color: opts?.color || '#66aaff',
    muted: false,
  };
  _state.tracks.push(track);
  return { ok: true, uuid: track.uuid };
}

export function removeTrack(uuid) {
  const i = _state.tracks.findIndex((t) => t.uuid === uuid);
  if (i < 0) return { ok: false };
  _state.tracks.splice(i, 1);
  return { ok: true };
}

export function addKey(trackUuid, frame, value) {
  const t = _state.tracks.find((x) => x.uuid === trackUuid);
  if (!t) return { ok: false };
  const f = Math.round(Number(frame) || 0);
  const existing = t.keys.findIndex((k) => k.frame === f);
  if (existing >= 0) t.keys[existing] = { frame: f, value };
  else {
    t.keys.push({ frame: f, value });
    t.keys.sort((a, b) => a.frame - b.frame);
  }
  return { ok: true, total: t.keys.length };
}

export function removeKey(trackUuid, frame) {
  const t = _state.tracks.find((x) => x.uuid === trackUuid);
  if (!t) return { ok: false };
  const f = Math.round(Number(frame) || 0);
  t.keys = t.keys.filter((k) => k.frame !== f);
  return { ok: true, total: t.keys.length };
}

function _sampleKeys(keys, frame) {
  if (!keys.length) return null;
  if (frame <= keys[0].frame) return keys[0].value;
  if (frame >= keys[keys.length - 1].frame) return keys[keys.length - 1].value;
  for (let i = 0; i + 1 < keys.length; i++) {
    if (keys[i].frame <= frame && frame <= keys[i + 1].frame) {
      const a = keys[i], b = keys[i + 1];
      const t = (frame - a.frame) / (b.frame - a.frame);
      if (typeof a.value === 'number') return a.value + (b.value - a.value) * t;
      if (Array.isArray(a.value)) return a.value.map((v, k) => v + (b.value[k] - v) * t);
      return a.value;
    }
  }
  return keys[keys.length - 1].value;
}

function _writeProperty(obj, propertyPath, value) {
  // propertyPath like ".position.y" or ".rotation.x" or ".scale".
  const parts = propertyPath.replace(/^\./, '').split('.');
  let cur = obj;
  for (let i = 0; i + 1 < parts.length; i++) cur = cur[parts[i]];
  if (!cur) return;
  cur[parts[parts.length - 1]] = value;
}

export function applyFrame(frame) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  for (const t of _state.tracks) {
    if (t.muted) continue;
    if (!t.keys.length) continue;
    const obj = scene.getObjectByProperty('uuid', t.targetUuid);
    if (!obj) continue;
    const v = _sampleKeys(t.keys, frame);
    if (v == null) continue;
    _writeProperty(obj, t.property, v);
    obj.updateMatrixWorld(true);
  }
  return { ok: true };
}

export function setFrame(frame) {
  _state.currentFrame = Math.max(_state.startFrame, Math.min(_state.endFrame, Math.round(frame)));
  applyFrame(_state.currentFrame);
  return { ok: true, frame: _state.currentFrame };
}

export function play() {
  _state.playing = true;
  _state.lastTickMs = performance.now();
  return { ok: true };
}

export function pause() {
  _state.playing = false;
  return { ok: true };
}

export function setRange(start, end) {
  _state.startFrame = Math.max(0, Math.round(start));
  _state.endFrame = Math.max(_state.startFrame + 1, Math.round(end));
  return { ok: true, start: _state.startFrame, end: _state.endFrame };
}

export function setFps(fps) {
  _state.fps = Math.max(1, Math.min(120, Math.round(fps)));
  return { ok: true, fps: _state.fps };
}

export function tick(now) {
  if (!_state.playing) return;
  const dt = (now - _state.lastTickMs) / 1000;
  _state.lastTickMs = now;
  const advance = dt * _state.fps;
  _state.currentFrame += advance;
  if (_state.currentFrame > _state.endFrame) _state.currentFrame = _state.startFrame;
  applyFrame(Math.round(_state.currentFrame));
}

export function listTracks() {
  return _state.tracks.map((t) => ({
    uuid: t.uuid, kind: t.kind, targetUuid: t.targetUuid, property: t.property,
    keys: t.keys.length, muted: t.muted, color: t.color,
  }));
}

export function setTrackMuted(uuid, on) {
  const t = _state.tracks.find((x) => x.uuid === uuid);
  if (!t) return { ok: false };
  t.muted = !!on;
  return { ok: true };
}

export function clearTimeline() {
  _state.tracks = [];
  _state.currentFrame = _state.startFrame;
  return { ok: true };
}

export function exportJson() {
  return JSON.stringify({
    tracks: _state.tracks,
    startFrame: _state.startFrame,
    endFrame: _state.endFrame,
    fps: _state.fps,
  });
}

export function importJson(json) {
  try {
    const o = JSON.parse(json);
    _state.tracks = Array.isArray(o.tracks) ? o.tracks : [];
    _state.startFrame = o.startFrame ?? 0;
    _state.endFrame = o.endFrame ?? 240;
    _state.fps = o.fps ?? 24;
    return { ok: true };
  } catch (_) {
    return { ok: false };
  }
}
