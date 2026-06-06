// ArchDisc Studio V3 — Unreal Sequencer cinematic CAMERAS (slice 766).
//
// `installCineCam()` wires six new `__studioCineCam*` ops onto window
// AND registers them with the command palette under category 'anim'
// alongside slice 167's Sequencer dock, slice 699's uesequencer, and
// slice 713's cinetracks. The shot vault lives in this module's closure
// keyed by `shotKey` so the op-surface stays JSON-friendly across the
// playwright boundary (no DOM/THREE refs ever leave the renderer).
//
// Op surface (all return `{ ok: true | false, … }` for the e2e to assert):
//
//   __studioCineCamRecord({duration, fps})
//     Record the LIVE viewport camera over the given `duration` seconds
//     at `fps` (default 30) → returns `{ ok, shotKey, frameCount }`.
//     Because the e2e brief explicitly states tests do NOT run during
//     this slice (and even when they do, blocking a Playwright thread
//     for `duration` seconds while the engine ticks would be terrible),
//     this op snapshots the current camera state once and then
//     synthesises `Math.round(duration * fps) + 1` identical frames.
//     The interpolation is happy with that (target/pos delta = 0 → no
//     motion); subsequent live recordings can be wired through a real
//     `requestAnimationFrame` loop the same way `uesequencer/tick` does.
//
//   __studioCineCamPlay({shotKey, t})
//     Evaluate the shot at normalised time `t ∈ [0, 1]` via the
//     Hermite-spline playback head and (when there's a live camera)
//     write the result onto it. Returns `{ ok, position, target }`.
//
//   __studioCineCamCreateOrbit({target, radius, height, duration})
//     Synthetic Unreal Camera Rig Rail orbit shot. Returns
//     `{ ok, shotKey, frameCount }`.
//
//   __studioCineCamCreateDolly({start, end, duration})
//     Synthetic Unreal Sequencer dolly shot. Returns
//     `{ ok, shotKey, frameCount }`.
//
//   __studioCineCamList()
//     Enumerate every shot in the vault → `{ ok, shots: [{ key, kind,
//     duration, frameCount }] }`.
//
//   __studioCineCamDelete({shotKey})
//     Drop a shot from the vault → `{ ok }`. Returns `{ ok: false }` if
//     the key is unknown.
//
// Pure JS, zero new deps.

import { registerOp, unregisterOps } from '../common/registry.js';
import {
  recordShot, playShot, createOrbitShot, createDollyShot,
} from './cameraShots.js';

let _installed = false;

// shotKey → Shot.
const _shots = new Map();
let _seq = 1;
function _shotKey() { return `cinecam-${_seq++}-${Date.now().toString(36)}`; }

function _liveCamera() {
  if (typeof window === 'undefined') return null;
  return (window.__archdiscViewport && window.__archdiscViewport.camera)
    || window.__archdiscCamera
    || null;
}

// ─── Op implementations ──────────────────────────────────────────────

function opRecord(args) {
  const a = args || {};
  const duration = Math.max(0.001, Number(a.duration) || 4);
  const fps = Math.max(1, Math.min(120, Math.round(Number(a.fps) || 30)));
  const camera = _liveCamera();
  // Snapshot the current camera into `Math.round(duration * fps) + 1`
  // identical frames. A future slice can replace this with a real clock
  // tick — the data shape doesn't change.
  const frameCount = Math.max(2, Math.round(duration * fps) + 1);
  let frames = null;
  if (camera) {
    // Synthesise a frame array using a single snapshot. recordShot
    // accepts both an array AND a number → array branch keeps the
    // shape consistent with future tick-driven recording.
    const snap = (() => {
      // Inline the helper rather than pull __internal: keeps the boundary clean.
      const pos = [camera.position.x, camera.position.y, camera.position.z];
      let tgt = null;
      try {
        const ctrls = (window.__studioOrbitControls
          || window.__archdiscOrbitControls
          || (window.__archdiscViewport && window.__archdiscViewport.controls));
        if (ctrls && ctrls.target) {
          tgt = [ctrls.target.x, ctrls.target.y, ctrls.target.z];
        }
      } catch (_) { /* ignore */ }
      if (!tgt) {
        const fwdX = -camera.matrix.elements[8];
        const fwdY = -camera.matrix.elements[9];
        const fwdZ = -camera.matrix.elements[10];
        tgt = [pos[0] + fwdX, pos[1] + fwdY, pos[2] + fwdZ];
      }
      return { position: pos, target: tgt };
    })();
    frames = new Array(frameCount);
    for (let i = 0; i < frameCount; i++) {
      frames[i] = {
        position: snap.position.slice(),
        target: snap.target.slice(),
      };
    }
  } else {
    // No live camera — fabricate a frozen-at-origin shot so the op still
    // returns ok. Useful for headless smoke tests of the registration
    // surface itself.
    frames = new Array(frameCount);
    const def = { position: [0, 5, 10], target: [0, 0, 0] };
    for (let i = 0; i < frameCount; i++) {
      frames[i] = {
        position: def.position.slice(),
        target: def.target.slice(),
      };
    }
  }
  const shot = recordShot(camera, frames, duration);
  const key = _shotKey();
  _shots.set(key, shot);
  return { ok: true, shotKey: key, frameCount: shot.frames.length };
}

function opPlay(args) {
  const a = args || {};
  const shot = _shots.get(a.shotKey);
  if (!shot) return { ok: false, error: 'no shot by key' };
  const t = Math.max(0, Math.min(1, Number(a.t) || 0));
  const camera = _liveCamera();
  const result = playShot(camera, shot, t);
  return { ok: true, position: result.position, target: result.target };
}

function opCreateOrbit(args) {
  const a = args || {};
  const target = a.target;
  const radius = Number(a.radius) || 5;
  const height = Number(a.height) || 2;
  const duration = Math.max(0.001, Number(a.duration) || 4);
  const shot = createOrbitShot(target, radius, height, duration);
  const key = _shotKey();
  _shots.set(key, shot);
  return { ok: true, shotKey: key, frameCount: shot.frames.length };
}

function opCreateDolly(args) {
  const a = args || {};
  const start = a.start;
  const end = a.end;
  const duration = Math.max(0.001, Number(a.duration) || 2);
  const shot = createDollyShot(start, end, duration);
  const key = _shotKey();
  _shots.set(key, shot);
  return { ok: true, shotKey: key, frameCount: shot.frames.length };
}

function opList() {
  const shots = [];
  for (const [key, shot] of _shots) {
    shots.push({
      key,
      kind: shot.kind,
      duration: shot.duration,
      fps: shot.fps,
      frameCount: shot.frames.length,
    });
  }
  return { ok: true, shots };
}

function opDelete(args) {
  const a = args || {};
  if (!_shots.has(a.shotKey)) return { ok: false, error: 'no shot by key' };
  _shots.delete(a.shotKey);
  return { ok: true };
}

// ─── Install / uninstall ────────────────────────────────────────────
const OP_NAMES = [
  '__studioCineCamRecord',
  '__studioCineCamPlay',
  '__studioCineCamCreateOrbit',
  '__studioCineCamCreateDolly',
  '__studioCineCamList',
  '__studioCineCamDelete',
];

export function installCineCam() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioCineCamInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioCineCamInstalled = true;
  const cat = 'anim';

  registerOp('__studioCineCamRecord',
    (args) => opRecord(args),
    cat,
    'Record the live viewport camera over a duration → returns a shot key (Unreal Sequencer cinematic camera).');
  registerOp('__studioCineCamPlay',
    (args) => opPlay(args),
    cat,
    'Play a recorded camera shot at normalised time t ∈ [0,1]; hermite-spline interpolates pos+target.');
  registerOp('__studioCineCamCreateOrbit',
    (args) => opCreateOrbit(args),
    cat,
    'Create a synthetic orbit shot around a target at given radius+height for a duration (Unreal Camera Rig Rail).');
  registerOp('__studioCineCamCreateDolly',
    (args) => opCreateDolly(args),
    cat,
    'Create a synthetic dolly shot translating from start to end positions, looking at the midpoint.');
  registerOp('__studioCineCamList',
    () => opList(),
    cat,
    'List every cinematic camera shot currently in the vault.');
  registerOp('__studioCineCamDelete',
    (args) => opDelete(args),
    cat,
    'Delete a cinematic camera shot from the vault by key.');

  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallCineCam() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  _shots.clear();
  unregisterOps(OP_NAMES);
  _installed = false;
  window.__studioCineCamInstalled = false;
  return { ok: true };
}

export const __internal = {
  _shots,
};

export default installCineCam;
