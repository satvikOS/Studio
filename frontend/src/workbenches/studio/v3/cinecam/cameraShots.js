// ArchDisc Studio V3 — Unreal Sequencer cinematic CAMERA SHOTS (slice 766).
//
// Distinct surface from the V3 slices already in flight around cinema:
//   • slice 167  Sequencer dock  — keyframe-track editor over arbitrary
//                                  scene properties
//   • slice 699  uesequencer     — master timeline / multi-track ABCs
//   • slice 713  cinetracks      — named cinematic TRACKS (camera path,
//                                  look-at-target, DOF, audio mix)
//                                  programmed against the anim tick
//
// The slice-766 cinecam ships the ONE primitive the four prior cinema
// slices didn't cover: a SHOT — a sampled `{position, target}` curve over
// a duration that can be (a) RECORDED from the live viewport camera,
// (b) PLAYED BACK with smooth interpolation at any normalised time
// `t ∈ [0, 1]`, and (c) SYNTHESISED from canonical Unreal Sequencer
// camera-rig presets (orbit / dolly). Pure JS, zero new deps.
//
// All four shot types share the same in-memory shape:
//
//   Shot {
//     kind: 'recorded' | 'orbit' | 'dolly',
//     duration: number,        // seconds
//     fps: number,             // sample rate
//     frames: [                // length === Math.round(duration * fps) + 1
//       { position: [x,y,z], target: [x,y,z] },
//       ...
//     ],
//     meta: { … }              // kind-specific extras (radius, height, etc.)
//   }
//
// recordShot(camera, frames, duration) snapshots position + target every
//   1/frames seconds (`frames` here is the array of normalised offsets the
//   op-surface generated, so this fn is the pure builder). The op-surface
//   `__studioCineCamRecord` is the one that ticks the live clock and calls
//   this with the appropriate sample schedule.
//
// playShot(camera, shot, t) is the playback head: walks to the floating-
//   point sample `t * (N-1)`, picks the cubic-Hermite tangents from the
//   neighbour frames, and writes the resulting position + target onto the
//   passed-in camera (or just returns the computed values if no camera is
//   provided — the e2e / non-viewport callers use this branch).
//
// createOrbitShot(target, radius, height, duration) builds a perfect
//   horizontal circle around `target` at the given radius + height. fps
//   defaults to 30. This is the "Unreal Camera Rig Rail / Crane" preset
//   the LevelSequence editor exposes.
//
// createDollyShot(start, end, duration) builds a linear translation
//   between two positions, all looking at the midpoint. Tracking the
//   subject = end is the next refinement.

// ────────────────────────────────────────────────────────────────────────
// Small vec3 helpers — avoid pulling THREE into a pure-data module so
// `cameraShots.js` stays trivially importable from anywhere.
function _v3(x, y, z) { return [+x || 0, +y || 0, +z || 0]; }
function _vec3From(v) {
  if (!v) return [0, 0, 0];
  if (Array.isArray(v)) return _v3(v[0], v[1], v[2]);
  return _v3(v.x, v.y, v.z);
}

// ────────────────────────────────────────────────────────────────────────
// Hermite cubic interpolation between two endpoints with one-sided
// finite-difference tangents derived from the surrounding frames. This is
// the C1 spline Unreal's Sequencer uses to make cuts between cam-rail
// keys feel "swoopy" — the linear interp the cinetracks slice ships looks
// snappy at low fps, the hermite spline doesn't.
//
// h00, h10, h01, h11 are the standard cubic Hermite basis polynomials.
function _h00(t) { const t2 = t * t; return 2 * t2 * t - 3 * t2 + 1; }
function _h10(t) { const t2 = t * t; return t2 * t - 2 * t2 + t; }
function _h01(t) { const t2 = t * t; return -2 * t2 * t + 3 * t2; }
function _h11(t) { const t2 = t * t; return t2 * t - t2; }

function _hermite1(p0, p1, m0, m1, t) {
  return _h00(t) * p0 + _h10(t) * m0 + _h01(t) * p1 + _h11(t) * m1;
}

function _hermiteVec3(p0, p1, m0, m1, t) {
  return [
    _hermite1(p0[0], p1[0], m0[0], m1[0], t),
    _hermite1(p0[1], p1[1], m0[1], m1[1], t),
    _hermite1(p0[2], p1[2], m0[2], m1[2], t),
  ];
}

// Catmull-Rom-style centripetal tangent: `(p[i+1] - p[i-1]) / 2`. At the
// endpoints we fall back to one-sided differences so the spline stays C0
// with no overshoot off the first or last sample.
function _tangentVec3(samples, i, key) {
  const n = samples.length;
  const a = samples[Math.max(0, i - 1)][key];
  const b = samples[Math.min(n - 1, i + 1)][key];
  return [
    (b[0] - a[0]) * 0.5,
    (b[1] - a[1]) * 0.5,
    (b[2] - a[2]) * 0.5,
  ];
}

// ────────────────────────────────────────────────────────────────────────
// Camera target inference. THREE's PerspectiveCamera doesn't store its
// look-at target explicitly — the camera matrix only encodes a forward
// direction. For RECORDING we either trust an OrbitControls `target` if
// one is mounted (the slice-281 viewport has one), or we project a unit
// forward ray to `camera.position - 1 * forward` so that playback still
// gives `lookAt` a stable, well-defined point.
function _readCameraPositionAndTarget(camera) {
  const position = _v3(camera.position.x, camera.position.y, camera.position.z);
  let target = null;
  // Prefer the explicit OrbitControls target if the viewport wired one.
  try {
    const ctrls = (typeof window !== 'undefined')
      && (window.__studioOrbitControls
          || window.__archdiscOrbitControls
          || (window.__archdiscViewport && window.__archdiscViewport.controls));
    if (ctrls && ctrls.target) {
      target = _v3(ctrls.target.x, ctrls.target.y, ctrls.target.z);
    }
  } catch (_) { /* ignore */ }
  if (!target) {
    // Project a unit forward ray.
    const forwardX = -camera.matrix.elements[8];
    const forwardY = -camera.matrix.elements[9];
    const forwardZ = -camera.matrix.elements[10];
    target = [
      position[0] + forwardX,
      position[1] + forwardY,
      position[2] + forwardZ,
    ];
  }
  return { position, target };
}

// ────────────────────────────────────────────────────────────────────────
// Public API.

// recordShot — pure builder. Either consumes an array of `{position,target}`
// frames (the live op-surface ticks position/target onto an array and
// hands it in) OR — for tests / non-viewport callers — accepts a numeric
// `frames` count and a `camera` to snapshot a SINGLE frame at the current
// camera state. Both modes return a Shot object.
//
// signature kept compatible with the brief:
//   recordShot(camera, frames, duration)
//
// where `frames` may be either:
//   • Array<{position, target}>  → frames already sampled
//   • number                     → snapshot `frames` copies of the current camera
//     (degenerate case but useful for headless tests that don't tick a clock)
export function recordShot(camera, frames, duration) {
  const dur = Math.max(0.001, Number(duration) || 1);
  let collected;
  if (Array.isArray(frames)) {
    collected = frames.map((f) => ({
      position: _vec3From(f && f.position),
      target: _vec3From(f && f.target),
    }));
  } else {
    const count = Math.max(2, Math.floor(Number(frames) || 2));
    const snap = camera
      ? _readCameraPositionAndTarget(camera)
      : { position: [0, 0, 5], target: [0, 0, 0] };
    collected = new Array(count);
    for (let i = 0; i < count; i++) {
      collected[i] = { position: snap.position.slice(), target: snap.target.slice() };
    }
  }
  if (collected.length < 2) {
    // A shot with one frame can't interpolate — pad to two by duplicating.
    if (collected.length === 1) {
      collected.push({
        position: collected[0].position.slice(),
        target: collected[0].target.slice(),
      });
    } else {
      collected = [
        { position: [0, 0, 5], target: [0, 0, 0] },
        { position: [0, 0, 5], target: [0, 0, 0] },
      ];
    }
  }
  // fps derived from the count + duration so playback stays uniform.
  const fps = (collected.length - 1) / dur;
  return {
    kind: 'recorded',
    duration: dur,
    fps,
    frames: collected,
    meta: {},
  };
}

// playShot — evaluate a shot at normalised time `t ∈ [0, 1]` using
// cubic-Hermite interpolation across the four neighbour frames. Returns
// `{ position, target }` always. If a `camera` is passed, also writes the
// values onto the camera (and calls `lookAt(target)` so the view actually
// updates).
export function playShot(camera, shot, t) {
  if (!shot || !Array.isArray(shot.frames) || shot.frames.length < 2) {
    return { position: [0, 0, 5], target: [0, 0, 0] };
  }
  const samples = shot.frames;
  const n = samples.length;
  const clamped = Math.max(0, Math.min(1, Number(t) || 0));
  const x = clamped * (n - 1);
  let i = Math.floor(x);
  if (i >= n - 1) i = n - 2;
  const localT = x - i;

  const p0 = samples[i].position;
  const p1 = samples[i + 1].position;
  const t0 = samples[i].target;
  const t1 = samples[i + 1].target;
  const mp0 = _tangentVec3(samples, i, 'position');
  const mp1 = _tangentVec3(samples, i + 1, 'position');
  const mt0 = _tangentVec3(samples, i, 'target');
  const mt1 = _tangentVec3(samples, i + 1, 'target');

  const position = _hermiteVec3(p0, p1, mp0, mp1, localT);
  const target = _hermiteVec3(t0, t1, mt0, mt1, localT);

  if (camera) {
    try {
      camera.position.set(position[0], position[1], position[2]);
      if (typeof camera.lookAt === 'function') {
        camera.lookAt(target[0], target[1], target[2]);
      }
      if (camera.updateMatrixWorld) camera.updateMatrixWorld(true);
      // If we know about the live OrbitControls, retarget them so the
      // user can resume manual orbit after the cinematic without the
      // camera snapping back to the prior target.
      try {
        const ctrls = (typeof window !== 'undefined')
          && (window.__studioOrbitControls
              || window.__archdiscOrbitControls
              || (window.__archdiscViewport && window.__archdiscViewport.controls));
        if (ctrls && ctrls.target && ctrls.target.set) {
          ctrls.target.set(target[0], target[1], target[2]);
          if (typeof ctrls.update === 'function') ctrls.update();
        }
      } catch (_) { /* ignore */ }
    } catch (_) { /* ignore — camera write best-effort */ }
  }
  return { position, target };
}

// createOrbitShot — synthetic Unreal Camera Rig Rail (circular rail):
// `count = Math.round(duration * fps) + 1` frames sampling a perfect
// circle of given `radius` at constant `height` above the target. Looks
// at the target the entire time.
export function createOrbitShot(target, radius, height, duration) {
  const dur = Math.max(0.001, Number(duration) || 4);
  const fps = 30;
  const tgt = _vec3From(target);
  const r = Math.max(0, Number(radius) || 5);
  const h = Number(height) || 2;
  const count = Math.max(2, Math.round(dur * fps) + 1);
  const frames = new Array(count);
  for (let i = 0; i < count; i++) {
    // angle goes 0 -> 2π so t=0 and t=1 land in the SAME spot (perfect
    // loop). The op-surface only ever asks for t in [0, 1] so this is
    // safe even though the last frame == the first frame.
    const a = (i / (count - 1)) * Math.PI * 2;
    const px = tgt[0] + Math.cos(a) * r;
    const py = tgt[1] + h;
    const pz = tgt[2] + Math.sin(a) * r;
    frames[i] = {
      position: [px, py, pz],
      target: [tgt[0], tgt[1], tgt[2]],
    };
  }
  return {
    kind: 'orbit',
    duration: dur,
    fps,
    frames,
    meta: { target: tgt, radius: r, height: h },
  };
}

// createDollyShot — synthetic Unreal Sequencer DOLLY: linear translation
// between two cam positions, both looking at the segment midpoint (the
// canonical "push-in shot"). 30 fps × duration sample.
export function createDollyShot(start, end, duration) {
  const dur = Math.max(0.001, Number(duration) || 2);
  const fps = 30;
  const a = _vec3From(start);
  const b = _vec3From(end);
  const mid = [
    (a[0] + b[0]) * 0.5,
    (a[1] + b[1]) * 0.5,
    (a[2] + b[2]) * 0.5,
  ];
  const count = Math.max(2, Math.round(dur * fps) + 1);
  const frames = new Array(count);
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1);
    frames[i] = {
      position: [
        a[0] + (b[0] - a[0]) * u,
        a[1] + (b[1] - a[1]) * u,
        a[2] + (b[2] - a[2]) * u,
      ],
      target: [mid[0], mid[1], mid[2]],
    };
  }
  return {
    kind: 'dolly',
    duration: dur,
    fps,
    frames,
    meta: { start: a, end: b },
  };
}

// Internal helpers re-exported for the e2e + the op surface.
export const __internal = {
  _readCameraPositionAndTarget,
  _hermiteVec3,
  _tangentVec3,
  _vec3From,
};
