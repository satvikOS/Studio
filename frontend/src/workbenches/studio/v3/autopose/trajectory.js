// ArchDisc Studio V3 — Cascadeur-style ballistic-trajectory keyframer.
//
// `fitBallisticTrajectory(armatureUuid, t0, t1, peakHeight)` bakes a
// parabolic vertical-trajectory keyframe set onto the armature ROOT
// (the Three.Group that owns the bone tree). The horizontal motion is
// linear between the armature's start XZ and an end XZ derived from
// the armature's current velocity hint (userData.archdiscStudioAutoPoseJumpEndXZ);
// the vertical motion follows
//
//     y(t) = y0 + (peakHeight) * (1 - 4 * ((t - mid) / dt)²)
//
// where mid = (t0 + t1) / 2 and dt = (t1 - t0). At t = mid the y-offset
// is exactly peakHeight; at t = t0 and t = t1 the offset is zero.
//
// Why bake on the armature root (and not on a bone)?
//   The IK chains in slice 682 are LOCAL — a hip-bone rotation displaces
//   the root only if the parent Group moves. Cascadeur's "jump" workflow
//   slides the whole character along a ballistic curve, then locks the
//   feet via AutoContact while the arms swing. Translating the root is
//   the correct Studio analogue.
//
// Keyframes are stored on the armature's userData under
// `archdiscStudioAutoPoseTrajectory` as a self-contained track so the
// downstream playback driver doesn't need to know about the autopose
// surface — the AutoPose installer registers a tick handler that
// samples the track every animation frame and writes the result onto
// arm.position. If the slice-481 anim/playback system is live it also
// publishes the track to __studioAnimCurveAdd so the dopesheet shows
// the jump.
//
// Sample density defaults to 12 keyframes (one every 1/12th of the
// jump) which is enough for a perceptually-smooth bezier interpolation
// without spamming the dopesheet.

import * as THREE from 'three';
import { __internal as comInt } from './com.js';

const TRACK_TAG = 'archdiscStudioAutoPoseTrajectory';
const TICKER_TAG = '__studioAutoPoseTrajectoryTicker';

// Earth gravity, m/s². Used so the e2e spec can sanity-check that a
// 1m-peak parabola has the right curvature; not literally consumed
// because the keyframes are PRE-COMPUTED, but stored on the track so
// downstream callers (e.g. AutoPosePanel) can show it.
const G = 9.81;

function _evalTrack(track, t) {
  // y = y0 + peak * (1 - 4 * u²)  where u = (t - mid) / (t1 - t0)
  const { t0, t1, peak, x0, x1, z0, z1, y0 } = track;
  if (t <= t0) return { x: x0, y: y0, z: z0 };
  if (t >= t1) return { x: x1, y: y0, z: z1 };
  const dt = t1 - t0;
  const mid = (t0 + t1) * 0.5;
  const u = (t - mid) / dt;
  const yOff = peak * (1 - 4 * u * u);
  const k = (t - t0) / dt;
  return {
    x: x0 + (x1 - x0) * k,
    y: y0 + Math.max(0, yOff),
    z: z0 + (z1 - z0) * k,
  };
}

/**
 * fitBallisticTrajectory(armatureUuid, t0, t1, peakHeight, opts?)
 *
 * opts:
 *   sampleCount       int (default 12) — keyframes baked along the arc
 *   endXZ             [x, z] absolute end position; falls back to
 *                     userData.archdiscStudioAutoPoseJumpEndXZ then to
 *                     the armature's current XZ (in-place jump)
 *   publishToDopesheet bool — if anim/playback is live, also push the
 *                     keys via __studioAnimCurveAdd (default true)
 *
 * Returns:
 *   { ok, track: { t0, t1, peak, samples: [{t,x,y,z}, ...] },
 *     publishedCurves: [uuid, ...] | null }
 */
export function fitBallisticTrajectory(armatureUuid, t0, t1, peakHeight, opts) {
  const arm = comInt.findArmature(armatureUuid);
  if (!arm) return { ok: false, error: 'no armature' };
  const o = opts || {};

  const T0 = Number(t0);
  const T1 = Number(t1);
  const PEAK = Number(peakHeight);
  if (!Number.isFinite(T0) || !Number.isFinite(T1) || T1 <= T0) {
    return { ok: false, error: 'bad time range' };
  }
  if (!Number.isFinite(PEAK) || PEAK < 0) {
    return { ok: false, error: 'bad peakHeight' };
  }
  const sampleCount = Math.max(2, Math.min(64,
    Math.floor(Number(o.sampleCount) || 12)));

  // Start position is the armature's current world XZ (root translation).
  arm.updateMatrixWorld(true);
  const x0 = arm.position.x;
  const z0 = arm.position.z;
  const y0 = arm.position.y;

  // End XZ — explicit override > userData hint > in-place.
  let endXZ = null;
  if (Array.isArray(o.endXZ) && o.endXZ.length === 2 &&
      Number.isFinite(o.endXZ[0]) && Number.isFinite(o.endXZ[1])) {
    endXZ = [Number(o.endXZ[0]), Number(o.endXZ[1])];
  } else if (Array.isArray(arm.userData.archdiscStudioAutoPoseJumpEndXZ)
             && arm.userData.archdiscStudioAutoPoseJumpEndXZ.length === 2) {
    endXZ = arm.userData.archdiscStudioAutoPoseJumpEndXZ.slice();
  } else {
    endXZ = [x0, z0];
  }

  const track = {
    t0: T0, t1: T1,
    peak: PEAK, g: G,
    x0, z0, y0,
    x1: endXZ[0], z1: endXZ[1],
    samples: [],
    createdAt: Date.now(),
  };

  // Bake `sampleCount + 1` keys inclusive of both endpoints. The
  // dopesheet drivers like to have an explicit key at each endpoint so
  // the playhead snaps cleanly.
  for (let i = 0; i <= sampleCount; i++) {
    const u = i / sampleCount;
    const t = T0 + u * (T1 - T0);
    const p = _evalTrack(track, t);
    track.samples.push({ t, x: p.x, y: p.y, z: p.z });
  }

  // Persist track on the armature so the tick handler can sample it.
  arm.userData[TRACK_TAG] = track;

  // Optionally publish curves into the anim/playback dopesheet — best-
  // effort; if the surface isn't loaded the trajectory still plays
  // because our tick handler reads userData directly.
  let publishedCurves = null;
  if ((o.publishToDopesheet === undefined ? true : !!o.publishToDopesheet)
       && typeof window !== 'undefined'
       && typeof window.__studioAnimCurveAdd === 'function'
       && typeof window.__studioAnimCurveAddKey === 'function') {
    publishedCurves = [];
    try {
      // 3 curves — one per position channel, all targeting the armature uuid.
      for (let ch = 0; ch < 3; ch++) {
        const r = window.__studioAnimCurveAdd(arm.uuid, 'position', ch);
        if (!r || !r.ok || !r.uuid) continue;
        for (const s of track.samples) {
          const v = ch === 0 ? s.x : ch === 1 ? s.y : s.z;
          window.__studioAnimCurveAddKey(r.uuid, s.t, v);
        }
        publishedCurves.push(r.uuid);
      }
    } catch (_) {
      // best-effort — don't break the bake
    }
  }

  // Install a tick handler exactly once per page so the parabola plays
  // back even without the dopesheet driver. The handler is fed the
  // current playhead time via window.__studioAnimGetState() if present,
  // otherwise it samples wall-clock time relative to install moment.
  _ensureTicker();

  return {
    ok: true,
    track: {
      t0, t1, peak: PEAK, g: G,
      x0, x1: endXZ[0], y0, z0, z1: endXZ[1],
      sampleCount: track.samples.length,
    },
    samples: track.samples,
    publishedCurves,
  };
}

/**
 * sampleTrajectory(armatureUuid, t) — evaluate the baked parabola at
 * time `t` without mutating the armature. Useful from the panel + e2e
 * spec for visualising the arc.
 */
export function sampleTrajectory(armatureUuid, t) {
  const arm = comInt.findArmature(armatureUuid);
  if (!arm) return { ok: false, error: 'no armature' };
  const track = arm.userData && arm.userData[TRACK_TAG];
  if (!track) return { ok: false, error: 'no trajectory baked' };
  const p = _evalTrack(track, Number(t) || 0);
  return { ok: true, t: Number(t) || 0, position: [p.x, p.y, p.z] };
}

/**
 * clearTrajectory(armatureUuid) — strip a previously-baked track so the
 * ticker stops driving the armature.
 */
export function clearTrajectory(armatureUuid) {
  const arm = comInt.findArmature(armatureUuid);
  if (!arm) return { ok: false, error: 'no armature' };
  if (arm.userData && arm.userData[TRACK_TAG]) {
    delete arm.userData[TRACK_TAG];
    return { ok: true, cleared: true };
  }
  return { ok: true, cleared: false };
}

// One global rAF-driven ticker scans every armature for a track and
// updates arm.position accordingly. If the anim playback system is
// running, we read its current time; otherwise we use a wall-clock
// fallback that resets on first install.
function _ensureTicker() {
  if (typeof window === 'undefined') return;
  if (window[TICKER_TAG]) return;
  const installedAt = performance.now() / 1000;
  const tick = () => {
    try {
      let time = null;
      if (typeof window.__studioAnimGetState === 'function') {
        try {
          const s = window.__studioAnimGetState();
          if (s && Number.isFinite(s.time)) time = s.time;
        } catch (_) {}
      }
      if (time == null) time = (performance.now() / 1000) - installedAt;

      const scene = window.__archdiscScene
        || (window.__archdiscViewport && window.__archdiscViewport.scene)
        || null;
      if (scene) {
        scene.traverse((o) => {
          if (!(o.userData && o.userData[comInt.ARM_TAG])) return;
          const track = o.userData[TRACK_TAG];
          if (!track) return;
          const p = _evalTrack(track, time);
          o.position.set(p.x, p.y, p.z);
          o.updateMatrixWorld(true);
        });
      }
    } catch (_) { /* swallow */ }
    window[TICKER_TAG + '_raf'] = requestAnimationFrame(tick);
  };
  window[TICKER_TAG] = true;
  window[TICKER_TAG + '_raf'] = requestAnimationFrame(tick);
}

export const __internal = {
  TRACK_TAG, TICKER_TAG, G,
  evalTrack: _evalTrack,
};
