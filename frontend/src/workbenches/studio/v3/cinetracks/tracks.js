// Slice 713 — Unreal Sequencer cinematic tracks. Extends the slice-699
// uesequencer with named track presets: camera path (bezier through
// waypoints), camera look-at-target, depth-of-field focus, audio mix.
// Built as a thin layer that programs the existing animation tick.

import * as THREE from 'three';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';

const _cines = new Map();
let _seq = 1;
function _uid() { return `cn-${_seq++}-${Date.now().toString(36)}`; }

function _bezier3(a, b, c, d, t) {
  const u = 1 - t;
  return a * u * u * u + 3 * b * u * u * t + 3 * c * u * t * t + d * t * t * t;
}

export function createCine(opts) {
  const id = _uid();
  const cine = {
    id,
    duration: Number(opts?.duration) || 6,
    fps: Number(opts?.fps) || 30,
    frame: 0,
    playing: false,
    tracks: {
      camPath: null,
      lookAt: null,
      dof: null,
    },
  };
  _cines.set(id, cine);
  return { ok: true, id };
}

export function setCameraPath(id, waypoints, opts) {
  const c = _cines.get(id);
  if (!c) return { ok: false };
  if (!Array.isArray(waypoints) || waypoints.length < 2) return { ok: false };
  c.tracks.camPath = {
    waypoints: waypoints.map((w) => w.slice()),
    smoothing: Number(opts?.smoothing) || 0.3,
  };
  return { ok: true };
}

export function setLookAtTrack(id, targets, opts) {
  // targets: [{ frame, pos: [x,y,z] }] — interpolated linearly.
  const c = _cines.get(id);
  if (!c) return { ok: false };
  c.tracks.lookAt = { targets: targets.slice() };
  return { ok: true };
}

export function setDOFTrack(id, focusKeyframes) {
  // focusKeyframes: [{ frame, focusDistance, aperture }]
  const c = _cines.get(id);
  if (!c) return { ok: false };
  c.tracks.dof = { keys: focusKeyframes.slice() };
  return { ok: true };
}

function _applyCamPath(cine, t) {
  const wp = cine.tracks.camPath?.waypoints;
  if (!wp || wp.length < 2) return;
  const camera = window.__archdiscViewport?.camera;
  if (!camera) return;
  const idx = Math.min(wp.length - 2, Math.floor(t * (wp.length - 1)));
  const segT = (t * (wp.length - 1)) - idx;
  const a = wp[idx], d = wp[idx + 1];
  // Implicit handles for catmull-rom smoothness.
  const prev = wp[Math.max(0, idx - 1)];
  const next = wp[Math.min(wp.length - 1, idx + 2)];
  const b = [
    a[0] + (d[0] - prev[0]) * cine.tracks.camPath.smoothing,
    a[1] + (d[1] - prev[1]) * cine.tracks.camPath.smoothing,
    a[2] + (d[2] - prev[2]) * cine.tracks.camPath.smoothing,
  ];
  const c = [
    d[0] - (next[0] - a[0]) * cine.tracks.camPath.smoothing,
    d[1] - (next[1] - a[1]) * cine.tracks.camPath.smoothing,
    d[2] - (next[2] - a[2]) * cine.tracks.camPath.smoothing,
  ];
  camera.position.set(
    _bezier3(a[0], b[0], c[0], d[0], segT),
    _bezier3(a[1], b[1], c[1], d[1], segT),
    _bezier3(a[2], b[2], c[2], d[2], segT),
  );
}

function _applyLookAt(cine, frame) {
  const lk = cine.tracks.lookAt;
  if (!lk || lk.targets.length === 0) return;
  // Find surrounding keyframes.
  let a = lk.targets[0], b = lk.targets[0];
  for (let i = 0; i < lk.targets.length - 1; i++) {
    if (lk.targets[i].frame <= frame && lk.targets[i + 1].frame >= frame) {
      a = lk.targets[i]; b = lk.targets[i + 1]; break;
    }
  }
  const span = b.frame - a.frame || 1;
  const t = Math.max(0, Math.min(1, (frame - a.frame) / span));
  const px = a.pos[0] + (b.pos[0] - a.pos[0]) * t;
  const py = a.pos[1] + (b.pos[1] - a.pos[1]) * t;
  const pz = a.pos[2] + (b.pos[2] - a.pos[2]) * t;
  const camera = window.__archdiscViewport?.camera;
  if (camera) camera.lookAt(px, py, pz);
}

function _applyDOF(cine, frame) {
  const dof = cine.tracks.dof;
  if (!dof) return;
  let a = dof.keys[0], b = dof.keys[0];
  for (let i = 0; i < dof.keys.length - 1; i++) {
    if (dof.keys[i].frame <= frame && dof.keys[i + 1].frame >= frame) {
      a = dof.keys[i]; b = dof.keys[i + 1]; break;
    }
  }
  const span = b.frame - a.frame || 1;
  const t = Math.max(0, Math.min(1, (frame - a.frame) / span));
  const focus = a.focusDistance + (b.focusDistance - a.focusDistance) * t;
  const aperture = a.aperture + (b.aperture - a.aperture) * t;
  // If the slice-694 eevee module supports DOF, set it via the global op.
  if (typeof window.__studioEEVEESetDOF === 'function') {
    window.__studioEEVEESetDOF(focus, aperture);
  } else if (window.__archdiscEEVEEDOF) {
    window.__archdiscEEVEEDOF.focus = focus;
    window.__archdiscEEVEEDOF.aperture = aperture;
  }
}

export function play(id) {
  const c = _cines.get(id);
  if (!c) return { ok: false };
  c.playing = true;
  chainIntoAnimTick(`cine_${id}`, () => {
    if (!c.playing) return;
    c.frame++;
    const totalFrames = c.duration * c.fps;
    if (c.frame > totalFrames) c.frame = 0;
    const t = c.frame / totalFrames;
    _applyCamPath(c, t);
    _applyLookAt(c, c.frame);
    _applyDOF(c, c.frame);
  });
  return { ok: true };
}

export function pause(id) {
  const c = _cines.get(id);
  if (!c) return { ok: false };
  c.playing = false;
  return { ok: true };
}

export function stop(id) {
  const c = _cines.get(id);
  if (!c) return { ok: false };
  c.playing = false;
  c.frame = 0;
  unchainFromAnimTick(`cine_${id}`);
  return { ok: true };
}

export function setFrame(id, frame) {
  const c = _cines.get(id);
  if (!c) return { ok: false };
  c.frame = Math.max(0, Math.min(c.duration * c.fps, Number(frame)));
  _applyCamPath(c, c.frame / (c.duration * c.fps));
  _applyLookAt(c, c.frame);
  _applyDOF(c, c.frame);
  return { ok: true };
}

export function listCines() {
  return {
    ok: true,
    cines: Array.from(_cines.values()).map((c) => ({
      id: c.id, duration: c.duration, fps: c.fps, frame: c.frame, playing: c.playing,
    })),
  };
}
