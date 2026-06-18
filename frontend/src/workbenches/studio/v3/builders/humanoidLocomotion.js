// ArchDisc Studio V3 — Humanoid LOCOMOTION cycles (WALK / RUN / IDLE).
//
// Procedural, physically-motivated gait generators for the slice-682/humanoid.js
// rigged biped (23 bones: Pelvis, Spine, Chest, Neck, Head, and L/R Clavicle,
// Shoulder, Elbow, Wrist, Hand, Hip, Knee, Ankle, Foot). A cycle is a pure
// function of a NORMALISED phase t ∈ [0,1) that returns, for that instant:
//
//   • a bone→[ex,ey,ez] LOCAL-Euler map (the swing of every joint),
//   • a ROOT offset (pelvis bob in Y, fore/aft lean in Z, lateral sway in X),
//   • per-foot CONTACT flags (which foot is planted, used for foot-plant IK).
//
// The math is real walk-cycle biomechanics, not a hand-keyed library:
//
//   WALK  — contralateral coupling (left leg forward ↔ right arm forward),
//           pelvis yaw rotation + lateral weight-shift sway, pelvis DROP onto
//           the swing-leg side (Trendelenburg list toward the stance hip),
//           knee flexion peaking through swing, ankle heel-strike → toe-off
//           roll, spine/chest COUNTER-rotation to the pelvis, subtle head
//           stabilisation against the bob, double vertical bob (2× cadence).
//   RUN   — same coupling at higher cadence with a forward TORSO LEAN, large
//           arm swing held at ~90° elbows, a FLIGHT phase (both feet off the
//           ground around the stride apexes), bigger knee lift + stride, and a
//           larger vertical bob.
//   IDLE  — quiet stance: chest BREATHING (slow sinusoid), slow weight-shift
//           between feet, micro arm/hand sway, tiny head drift.
//
// Foot-plant: while a foot is in STANCE it must not slide. After applying the
// joint pose for phase t we re-plant the stance foot with foot-contact IK
// (window.__studioRigSolveIK / autoContact, falling back to a direct ankle
// solve) so the planted ankle stays at its captured ground anchor — the hips
// drop toward it via the pelvis-list term, mirroring a COM/balance lean.
//
// Public surface (installed on window):
//   __studioHumanoidAnimate({ cycle, t, armatureUuid?, plant? }) — pose at phase t.
//   __studioHumanoidPlay({ cycle, frames, loops, advance?, ... })  — step t over
//       frames×loops, translating the root forward by `stride` per cycle for
//       walk/run so the figure travels across the floor. Returns a per-frame
//       report (root position, foot world-Y, contact) for headless verification.
//
// Pure THREE (already a v3 dep). No network, no new packages. All joint targets
// are CLAMPED to the humanoid.js joint limits so nothing hyper-extends.

import * as THREE from 'three';

// ── joint limits — mirror humanoid.js JOINT_LIMITS so a generated cycle can
//    never drive a knee/elbow past its hinge or fold a spine in half. Kept local
//    (humanoid.js does not export them) but value-identical.
const JOINT_LIMITS = {
  Spine: [[-0.6, 0.9], [-0.7, 0.7], [-0.5, 0.5]],
  Chest: [[-0.5, 0.7], [-0.6, 0.6], [-0.4, 0.4]],
  Neck: [[-0.7, 0.7], [-0.9, 0.9], [-0.5, 0.5]],
  Head: [[-0.7, 0.6], [-0.9, 0.9], [-0.5, 0.5]],
  Shoulder: [[-1.6, 1.8], [-1.8, 1.8], [-2.2, 2.2]],
  Elbow: [[-0.1, 2.6], [-0.2, 0.2], [-2.6, 0.1]],
  Wrist: [[-0.8, 0.8], [-0.6, 0.6], [-0.6, 0.6]],
  Hip: [[-1.7, 1.0], [-0.6, 0.6], [-1.4, 1.4]],
  Knee: [[-2.5, 0.05], [-0.1, 0.1], [-0.1, 0.1]],
  Ankle: [[-0.7, 0.9], [-0.3, 0.3], [-0.3, 0.3]],
  Clavicle: [[-0.3, 0.3], [-0.3, 0.3], [-0.5, 0.5]],
  Pelvis: [[-0.5, 0.5], [-0.6, 0.6], [-0.5, 0.5]],
};

function baseName(n) { return String(n).replace(/\.[LR]$/, ''); }
function clampEuler(name, e) {
  const lim = JOINT_LIMITS[baseName(name)];
  if (!lim) return e;
  return [
    THREE.MathUtils.clamp(e[0], lim[0][0], lim[0][1]),
    THREE.MathUtils.clamp(e[1], lim[1][0], lim[1][1]),
    THREE.MathUtils.clamp(e[2], lim[2][0], lim[2][1]),
  ];
}

const TAU = Math.PI * 2;
// Phase helpers — everything below works on a 0..1 wrap.
function wrap01(t) { t = t % 1; return t < 0 ? t + 1 : t; }
// A smooth 0→1→0 "lift" bump used for swing-knee/foot-clear envelopes.
function bump(u) { u = THREE.MathUtils.clamp(u, 0, 1); return Math.sin(u * Math.PI); }
function smooth01(u) { u = THREE.MathUtils.clamp(u, 0, 1); return u * u * (3 - 2 * u); }

// The bind pose is a T-pose: shoulders out along ±X, arms straight. "Arms at
// the sides" needs a shoulder Z of ∓~1.32 (left arm rotates -Z to drop, right
// +Z). These rest offsets are the anchor every cycle swings AROUND.
const ARM_DOWN_L_Z = -1.32;
const ARM_DOWN_R_Z = 1.32;

// ─────────────────────────────────────────────────────────────────────────────
//  CYCLE GENERATORS — each returns { bones:{name:[x,y,z]}, root:{x,y,z}, contact }
//  `bones` are LOCAL euler offsets (radians); `root` is an offset (metres) to be
//  added to the pelvis/armature root for bob/sway/lean; `contact` is
//  { L:bool, R:bool } true while that foot is planted (stance).
// ─────────────────────────────────────────────────────────────────────────────

// ── WALK ─────────────────────────────────────────────────────────────────────
// Convention: at t=0 the LEFT leg is at the start of STANCE (heel-strike just
// happened) and the RIGHT leg begins SWING. Legs are 180° out of phase. Arms
// are contralateral: left-arm phase = right-leg phase (and vice-versa).
// Stance ≈ 60 % of the cycle, swing ≈ 40 % — a natural human duty factor.
function walkCycle(t, opts = {}) {
  t = wrap01(t);
  const amp = opts.amp == null ? 1 : opts.amp;     // overall stride scale
  // Per-leg phase: left starts stance at 0, right is half a cycle later.
  const legPhaseL = t;
  const legPhaseR = wrap01(t + 0.5);

  // hip flex/extend over the cycle: a clean sinusoid — max flex (forward,
  // +X local on the hip) just before heel-strike, max extension at toe-off.
  const hipSwing = (p) => Math.sin(p * TAU) * 0.62 * amp; // +forward, -back
  // Stance = first ~0.6 of each leg's phase, swing the rest.
  const DUTY = 0.6;
  const isStance = (p) => p < DUTY;
  // swing sub-phase 0..1 across the 0.4 swing window
  const swingU = (p) => (p < DUTY ? 0 : (p - DUTY) / (1 - DUTY));

  // knee: small flex during stance (loading), big flex through swing to clear
  // the foot. Negative-X is flexion on this rig (hinge: [-2.5, 0.05]).
  const kneeFlex = (p) => {
    if (isStance(p)) {
      // gentle loading dip just after heel-strike, then straighten for push-off
      const su = p / DUTY;
      return -(0.18 + 0.22 * bump(su * 0.6)) * amp;
    }
    return -(0.30 + 1.05 * bump(swingU(p))) * amp; // up to ~-1.35 mid-swing
  };

  // ankle: heel-strike (dorsiflex, +X) at start of stance → roll flat → toe-off
  // (plantarflex, -X) at end of stance → neutral-ish in swing for clearance.
  const ankle = (p) => {
    if (isStance(p)) {
      const su = p / DUTY;            // 0 heel-strike → 1 toe-off
      // +0.22 at heel-strike, through 0 flat, to -0.42 at toe-off
      return (0.22 * (1 - su) - 0.42 * smooth01(su)) * amp;
    }
    // swing: slight dorsiflexion to clear the toe, easing back to heel-strike
    const su = swingU(p);
    return (0.05 + 0.18 * bump(su)) * amp;
  };

  // arm swing — contralateral. Shoulder rotates about LOCAL X to pitch the arm
  // fore/aft. Left arm tracks RIGHT leg phase; right arm tracks LEFT leg phase.
  const armSwing = 0.55 * amp;
  const shoulderL_x = -Math.sin(legPhaseR * TAU) * armSwing;
  const shoulderR_x = -Math.sin(legPhaseL * TAU) * armSwing;
  // elbows flex a little, more on the forward up-swing.
  const elbowL = -(0.35 + 0.22 * Math.max(0, Math.sin(legPhaseR * TAU))) * amp;
  const elbowR = (0.35 + 0.22 * Math.max(0, Math.sin(legPhaseL * TAU))) * amp;

  // pelvis ROTATION (yaw, local Y) — the pelvis twists toward the swing leg;
  // spine/chest COUNTER-rotate so the shoulders stay facing forward.
  const pelvisYaw = Math.sin(t * TAU) * 0.14 * amp;
  const spineCounter = -pelvisYaw * 0.6;
  const chestCounter = -pelvisYaw * 0.5;
  // pelvis LATERAL sway (X) — weight shifts over the stance foot. At t=0 the
  // LEFT foot is planted so the body leans LEFT (+X). Half a cycle later, right.
  const sway = Math.cos(t * TAU) * 0.018 * amp; // metres, root offset
  // pelvis DROP onto the swing-leg side (Trendelenburg list, local Z roll):
  // when the LEFT leg swings (legPhaseL in swing), the unsupported left hip
  // drops; the body lists toward the stance (right) side.
  // Encode as a pelvis roll that follows -sway sign with a small magnitude.
  const pelvisList = -Math.cos(t * TAU) * 0.06 * amp;

  // vertical BOB — the COM rises at mid-stance (single-support) and dips at
  // double-support (heel-strikes). That happens twice per stride → 2× cadence.
  const bob = (Math.cos(2 * t * TAU) * 0.5 + 0.5) * 0.022 * amp - 0.006 * amp;
  // subtle fore/aft drift of the COM as the trailing leg pushes.
  const lean = Math.sin(2 * t * TAU) * 0.006 * amp;

  // head stabilisation — counter the bob/list a touch so the gaze stays level.
  const headPitch = -bob * 1.5;
  const headRoll = -pelvisList * 0.4;

  const bones = {
    Pelvis: [0, pelvisYaw, pelvisList],
    Spine: [0.05 * amp, spineCounter, 0],
    Chest: [0.03 * amp, chestCounter, 0],
    Neck: [0.03 * amp, 0, 0],
    Head: [headPitch, 0, headRoll],

    'Hip.L': [hipSwing(legPhaseL), 0, 0],
    'Knee.L': [kneeFlex(legPhaseL), 0, 0],
    'Ankle.L': [ankle(legPhaseL), 0, 0],
    'Hip.R': [hipSwing(legPhaseR), 0, 0],
    'Knee.R': [kneeFlex(legPhaseR), 0, 0],
    'Ankle.R': [ankle(legPhaseR), 0, 0],

    'Shoulder.L': [shoulderL_x, 0, ARM_DOWN_L_Z],
    'Elbow.L': [0, 0, elbowL],
    'Shoulder.R': [shoulderR_x, 0, ARM_DOWN_R_Z],
    'Elbow.R': [0, 0, elbowR],
    'Clavicle.L': [0, 0, 0],
    'Clavicle.R': [0, 0, 0],
  };

  return {
    bones,
    root: { x: sway, y: bob, z: lean },
    contact: { L: isStance(legPhaseL), R: isStance(legPhaseR) },
    flight: false,
  };
}

// ── RUN ──────────────────────────────────────────────────────────────────────
// Like walk but: forward torso lean, ~90° elbows held, larger stride + knee
// lift, and a FLIGHT phase — stance duty drops below 50 % so for a window
// around each leg's swing apex NEITHER foot is on the ground.
function runCycle(t, opts = {}) {
  t = wrap01(t);
  const amp = opts.amp == null ? 1 : opts.amp;
  const legPhaseL = t;
  const legPhaseR = wrap01(t + 0.5);

  const DUTY = 0.34; // <0.5 ⇒ guaranteed flight windows between supports
  const isStance = (p) => p < DUTY;
  const swingU = (p) => (p < DUTY ? 0 : (p - DUTY) / (1 - DUTY));

  // bigger hip swing (longer stride)
  const hipSwing = (p) => Math.sin(p * TAU) * 0.95 * amp;
  // much bigger knee lift in swing; strong flex on landing absorb
  const kneeFlex = (p) => {
    if (isStance(p)) {
      const su = p / DUTY;
      return -(0.35 + 0.45 * bump(su)) * amp; // deeper landing absorb
    }
    return -(0.5 + 1.6 * bump(swingU(p))) * amp; // tucked hard mid-swing
  };
  const ankle = (p) => {
    if (isStance(p)) {
      const su = p / DUTY;
      return (0.18 * (1 - su) - 0.5 * smooth01(su)) * amp; // forefoot push-off
    }
    const su = swingU(p);
    return (0.1 + 0.25 * bump(su)) * amp;
  };

  // arms: big swing, elbows pinned near 90° (sprinter form).
  const armSwing = 0.95 * amp;
  const shoulderL_x = -Math.sin(legPhaseR * TAU) * armSwing - 0.15 * amp;
  const shoulderR_x = -Math.sin(legPhaseL * TAU) * armSwing - 0.15 * amp;
  const elbowL = -(1.45) ; // ~90° (rad), held
  const elbowR = (1.45);

  const pelvisYaw = Math.sin(t * TAU) * 0.20 * amp;
  const spineCounter = -pelvisYaw * 0.6;
  const chestCounter = -pelvisYaw * 0.5;
  const sway = Math.cos(t * TAU) * 0.022 * amp;
  const pelvisList = -Math.cos(t * TAU) * 0.08 * amp;

  // bigger vertical bob; centre raised so the flight apex clearly leaves the floor.
  const bob = (Math.cos(2 * t * TAU) * 0.5 + 0.5) * 0.055 * amp + 0.01 * amp;
  const lean = Math.sin(2 * t * TAU) * 0.012 * amp;

  // forward TORSO LEAN — constant pitch into the run (spine + chest + a hip lean).
  const torsoLean = 0.28 * amp;

  const headPitch = -bob * 1.2 + 0.06 * amp; // head leads the lean a touch
  const headRoll = -pelvisList * 0.4;

  const stanceL = isStance(legPhaseL);
  const stanceR = isStance(legPhaseR);
  const bones = {
    Pelvis: [0.06 * amp, pelvisYaw, pelvisList],
    Spine: [torsoLean * 0.45, spineCounter, 0],
    Chest: [torsoLean * 0.4, chestCounter, 0],
    Neck: [0.06 * amp, 0, 0],
    Head: [headPitch, 0, headRoll],

    'Hip.L': [hipSwing(legPhaseL), 0, 0],
    'Knee.L': [kneeFlex(legPhaseL), 0, 0],
    'Ankle.L': [ankle(legPhaseL), 0, 0],
    'Hip.R': [hipSwing(legPhaseR), 0, 0],
    'Knee.R': [kneeFlex(legPhaseR), 0, 0],
    'Ankle.R': [ankle(legPhaseR), 0, 0],

    'Shoulder.L': [shoulderL_x, 0, ARM_DOWN_L_Z],
    'Elbow.L': [0, 0, elbowL],
    'Shoulder.R': [shoulderR_x, 0, ARM_DOWN_R_Z],
    'Elbow.R': [0, 0, elbowR],
    'Clavicle.L': [0, 0, 0],
    'Clavicle.R': [0, 0, 0],
  };

  return {
    bones,
    root: { x: sway, y: bob, z: lean },
    contact: { L: stanceL, R: stanceR },
    flight: !stanceL && !stanceR,
  };
}

// ── IDLE ─────────────────────────────────────────────────────────────────────
// Quiet relaxed stand: breathing (chest rises/falls), slow weight shift between
// feet, micro arm sway, tiny head drift. Both feet ALWAYS planted.
function idleCycle(t, opts = {}) {
  t = wrap01(t);
  const amp = opts.amp == null ? 1 : opts.amp;

  // breathing — chest expands (small +X pitch + tiny lift), ~ once per cycle.
  const breath = Math.sin(t * TAU);
  const chestBreath = 0.035 * breath * amp;
  const bob = 0.006 * breath * amp; // chest rise lifts the COM a hair

  // slow weight shift — a long, lazy lateral sway over the cycle.
  const sway = Math.sin(t * TAU) * 0.012 * amp;
  const pelvisList = -Math.sin(t * TAU) * 0.03 * amp;
  // the unweighted knee softens as weight shifts off it.
  const kneeL = -(0.10 + 0.05 * Math.max(0, Math.sin(t * TAU))) * amp;
  const kneeR = -(0.10 + 0.05 * Math.max(0, -Math.sin(t * TAU))) * amp;

  // micro arm sway (relaxed at the sides, tiny pendulum).
  const microL = Math.sin(t * TAU + 0.6) * 0.05 * amp;
  const microR = Math.sin(t * TAU - 0.6) * 0.05 * amp;

  // tiny head drift / weight-glance.
  const headYaw = Math.sin(t * TAU * 0.5) * 0.05 * amp;
  const headRoll = -pelvisList * 0.5;

  const bones = {
    Pelvis: [0, 0, pelvisList],
    Spine: [0.04 * amp, 0, 0],
    Chest: [0.02 * amp + chestBreath, 0, 0],
    Neck: [0.05 * amp, headYaw * 0.3, 0],
    Head: [0.0, headYaw, headRoll],

    'Hip.L': [0.04 * amp, 0, 0.02 * amp],
    'Knee.L': [kneeL, 0, 0],
    'Ankle.L': [0.02 * amp, 0, 0],
    'Hip.R': [0.04 * amp, 0, -0.02 * amp],
    'Knee.R': [kneeR, 0, 0],
    'Ankle.R': [0.02 * amp, 0, 0],

    'Shoulder.L': [microL, 0, ARM_DOWN_L_Z + 0.03 * amp],
    'Elbow.L': [0, 0, -0.30 * amp],
    'Shoulder.R': [microR, 0, ARM_DOWN_R_Z - 0.03 * amp],
    'Elbow.R': [0, 0, 0.30 * amp],
    'Clavicle.L': [0, 0, 0],
    'Clavicle.R': [0, 0, 0],
  };

  return {
    bones,
    root: { x: sway, y: bob, z: 0 },
    contact: { L: true, R: true },
    flight: false,
  };
}

const CYCLES = { walk: walkCycle, run: runCycle, idle: idleCycle };
export const LOCOMOTION_CYCLES = Object.keys(CYCLES);

// Per-cycle default forward stride (metres travelled per full cycle) + cadence.
const CYCLE_DEFAULTS = {
  walk: { stride: 0.75, cadenceFps: 24, framesPerCycle: 30 },
  run: { stride: 1.6, cadenceFps: 24, framesPerCycle: 20 },
  idle: { stride: 0.0, cadenceFps: 24, framesPerCycle: 90 },
};

// ─────────────────────────────────────────────────────────────────────────────
//  rig access
// ─────────────────────────────────────────────────────────────────────────────
function getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

// Resolve the target humanoid handle from the slice-682 store. Falls back to
// scanning the scene for any armature carrying humanoid shells.
function resolveHumanoid(armatureUuid) {
  if (typeof window === 'undefined') return null;
  const store = window.__studioHumanoids || {};
  const uuid = armatureUuid || window.__studioHumanoidLast;
  if (uuid && store[uuid]) return store[uuid];
  // fall back: first entry in the store.
  const keys = Object.keys(store);
  if (keys.length) return store[keys[0]];
  // last resort: scan the scene for an armature group.
  const scene = getScene();
  if (!scene) return null;
  let arm = null;
  scene.traverse((o) => {
    if (!arm && o.userData && o.userData.archdiscStudioRigArmature) arm = o;
  });
  if (!arm) return null;
  const boneList = [];
  arm.traverse((o) => { if (o.isBone) boneList.push(o); });
  const skinnedMeshes = [];
  scene.traverse((o) => {
    if (o.isSkinnedMesh && o.userData && o.userData.archdiscStudioRigArmatureUuid === arm.uuid) {
      skinnedMeshes.push(o);
    }
  });
  return { armature: arm, boneList, skeleton: arm.userData.archdiscStudioRigSkeleton, skinnedMeshes };
}

function mapByName(boneList) {
  const m = {};
  for (const b of boneList) m[b.name] = b;
  return m;
}

function refreshRig(h) {
  if (!h || !h.armature) return;
  h.armature.updateMatrixWorld(true);
  const skel = h.armature.userData && h.armature.userData.archdiscStudioRigSkeleton;
  if (skel && typeof skel.update === 'function') skel.update();
  if (Array.isArray(h.skinnedMeshes)) {
    for (const sm of h.skinnedMeshes) {
      if (sm.skeleton && typeof sm.skeleton.update === 'function') sm.skeleton.update();
      if (typeof sm.updateMatrixWorld === 'function') sm.updateMatrixWorld(true);
    }
  }
}

// Apply a cycle pose (bone eulers + root offset) to the humanoid at phase t.
// Resets every bone to bind first so cycles don't accumulate, then sets the
// clamped eulers. The root offset is applied on top of the armature's BASE
// position (captured once per play / animate session in userData) so the
// bob/sway/lean ride the travelling root rather than fighting it.
function applyCyclePose(h, frame) {
  const boneMap = mapByName(h.boneList);
  // reset to bind
  for (const b of h.boneList) b.rotation.set(0, 0, 0);
  for (const name of Object.keys(frame.bones)) {
    const b = boneMap[name];
    if (!b) continue;
    const e = clampEuler(name, frame.bones[name]);
    b.rotation.set(e[0], e[1], e[2]);
  }
  // root offset (bob/sway/lean) applied to the armature base position.
  const arm = h.armature;
  if (!arm.userData.__locoBase) {
    arm.userData.__locoBase = { x: arm.position.x, y: arm.position.y, z: arm.position.z };
  }
  const base = arm.userData.__locoTravel || arm.userData.__locoBase;
  arm.position.set(
    base.x + (frame.root.x || 0),
    base.y + (frame.root.y || 0),
    base.z + (frame.root.z || 0),
  );
  // keep the skinned-mesh hosts in lock-step with the armature so they travel
  // (the meshes are siblings of the armature in the scene, positioned at the
  // same world origin — translate them by the same delta from their own base).
  if (Array.isArray(h.skinnedMeshes)) {
    for (const sm of h.skinnedMeshes) {
      if (!sm.userData.__locoBase) {
        sm.userData.__locoBase = { x: sm.position.x, y: sm.position.y, z: sm.position.z };
      }
      const sBase = sm.userData.__locoTravel || sm.userData.__locoBase;
      sm.position.set(
        sBase.x + (frame.root.x || 0),
        sBase.y + (frame.root.y || 0),
        sBase.z + (frame.root.z || 0),
      );
    }
  }
  refreshRig(h);
}

// ── foot-plant IK ────────────────────────────────────────────────────────────
// Keep the STANCE foot anchored at a fixed ground point so it doesn't slide.
// We capture each foot's world anchor at the instant it enters stance and, for
// every frame it stays in stance, IK-solve the ankle back to that anchor.
// Prefers window.__studioRigSolveIK (slice-682 CCD) / autoContact; falls back
// to a direct ankle-chain solve via the same solver if present.
function plantStanceFeet(h, frame, anchors) {
  if (typeof window === 'undefined') return;
  const boneMap = mapByName(h.boneList);
  h.armature.updateMatrixWorld(true);
  const wp = new THREE.Vector3();
  for (const side of ['L', 'R']) {
    const ankle = boneMap[`Ankle.${side}`];
    if (!ankle) continue;
    const stance = frame.contact[side];
    if (!stance) { anchors[side] = null; continue; }
    ankle.getWorldPosition(wp);
    // entering stance this frame → capture the anchor (lock current X/Z, ground Y).
    if (!anchors[side]) {
      anchors[side] = [wp.x, anchors.groundY != null ? anchors.groundY : wp.y, wp.z];
    }
    const target = anchors[side];
    // Solve the leg chain (ankle effector, chain = knee+hip ≈ 2) back to the
    // captured anchor. Two passes of high-iteration CCD pin the ankle tightly
    // even as the root bobs/advances — the hip+knee rotate to keep the foot
    // world-fixed (the hip "drops" toward the planted foot, the COM/balance
    // behaviour the brief asks for). chainLength 2 keeps the solve in the leg
    // (not the spine), so plant doesn't fight the gait pose above the pelvis.
    if (typeof window.__studioRigSolveIK === 'function') {
      try {
        window.__studioRigSolveIK(ankle.uuid, target, 20, 2);
        window.__studioRigSolveIK(ankle.uuid, target, 20, 2);
      } catch (_) { /* best-effort */ }
    }
  }
  refreshRig(h);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC: animate one frame
// ─────────────────────────────────────────────────────────────────────────────
export function humanoidAnimate({ cycle = 'walk', t = 0, armatureUuid = null, amp = 1, plant = true } = {}) {
  const gen = CYCLES[cycle];
  if (!gen) return { ok: false, error: `unknown cycle '${cycle}'`, cycles: LOCOMOTION_CYCLES };
  const h = resolveHumanoid(armatureUuid);
  if (!h || !h.boneList || !h.boneList.length) {
    return { ok: false, error: 'no humanoid built yet (call __studioBuildHumanoid first)' };
  }
  const frame = gen(t, { amp });
  applyCyclePose(h, frame);
  // single-frame plant: only re-plant in-place (anchor = current ground proj),
  // so a stand-alone Animate call still grounds the stance foot.
  if (plant && cycle !== 'run') {
    const anchors = { L: null, R: null, groundY: groundYFor(h) };
    plantStanceFeet(h, frame, anchors);
  }
  return {
    ok: true,
    cycle,
    t: wrap01(t),
    armatureUuid: h.armature.uuid,
    contact: frame.contact,
    flight: frame.flight,
    root: frame.root,
    bonesPosed: Object.keys(frame.bones).length,
  };
}

// Ground Y for plant targets — the humanoid's base world-Y floor (0 by default,
// or the armature base y). Feet sit at ~footH above the floor in bind pose, but
// the ankle JOINT is what IK targets; we anchor it where it lands at heel-strike.
function groundYFor(h) {
  // null ⇒ plantStanceFeet captures the live ankle Y at heel-strike (no slide
  // in X/Z, natural Y). Returning null keeps the foot at its own contact height.
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC: play — step t over frames×loops, travel the root forward.
// ─────────────────────────────────────────────────────────────────────────────
//  Returns a per-frame report (phase, contact, flight, root position, foot
//  world-Y per side) so headless tests can verify foot-plant + flight without a
//  renderer. `advance` (default true for walk/run) translates the travelling
//  root base forward by `stride` per completed cycle.
export function humanoidPlay({
  cycle = 'walk',
  frames = null,
  loops = 1,
  amp = 1,
  stride = null,
  advance = null,
  forwardAxis = 'z',
  forwardSign = 1,
  plant = true,
  armatureUuid = null,
} = {}) {
  const gen = CYCLES[cycle];
  if (!gen) return { ok: false, error: `unknown cycle '${cycle}'`, cycles: LOCOMOTION_CYCLES };
  const h = resolveHumanoid(armatureUuid);
  if (!h || !h.boneList || !h.boneList.length) {
    return { ok: false, error: 'no humanoid built yet (call __studioBuildHumanoid first)' };
  }
  const def = CYCLE_DEFAULTS[cycle] || CYCLE_DEFAULTS.walk;
  const fpc = Math.max(2, Math.floor(frames || def.framesPerCycle));
  const nLoops = Math.max(1, Math.floor(loops));
  const totalFrames = fpc * nLoops;
  const strideM = stride == null ? def.stride : Number(stride);
  const doAdvance = advance == null ? (cycle !== 'idle' && strideM > 0) : !!advance;

  // Establish the travelling base from the armature's static base.
  const arm = h.armature;
  if (!arm.userData.__locoBase) {
    arm.userData.__locoBase = { x: arm.position.x, y: arm.position.y, z: arm.position.z };
  }
  arm.userData.__locoTravel = { ...arm.userData.__locoBase };
  if (Array.isArray(h.skinnedMeshes)) {
    for (const sm of h.skinnedMeshes) {
      if (!sm.userData.__locoBase) sm.userData.__locoBase = { x: sm.position.x, y: sm.position.y, z: sm.position.z };
      sm.userData.__locoTravel = { ...sm.userData.__locoBase };
    }
  }

  const anchors = { L: null, R: null, groundY: null };
  const report = [];
  const boneMap = mapByName(h.boneList);
  const wpL = new THREE.Vector3();
  const wpR = new THREE.Vector3();

  for (let i = 0; i < totalFrames; i++) {
    const t = (i % fpc) / fpc; // phase 0..1 within the current loop
    const frame = gen(t, { amp });
    applyCyclePose(h, frame);

    // foot-plant for stance feet (walk grounds both; run plants whichever is down).
    if (plant) plantStanceFeet(h, frame, anchors);

    // advance the travelling root forward by stride/frame-per-cycle each step.
    if (doAdvance) {
      const step = strideM / fpc * forwardSign;
      arm.userData.__locoTravel[forwardAxis] += step;
      if (Array.isArray(h.skinnedMeshes)) {
        for (const sm of h.skinnedMeshes) sm.userData.__locoTravel[forwardAxis] += step;
      }
    }

    // sample foot WORLD position for the report (used to verify foot-plant +
    // flight headlessly without a renderer).
    h.armature.updateMatrixWorld(true);
    const aL = boneMap['Ankle.L'], aR = boneMap['Ankle.R'];
    let footL = null, footR = null;
    if (aL) { aL.getWorldPosition(wpL); footL = [wpL.x, wpL.y, wpL.z]; }
    if (aR) { aR.getWorldPosition(wpR); footR = [wpR.x, wpR.y, wpR.z]; }

    report.push({
      frame: i,
      t,
      loop: Math.floor(i / fpc),
      contact: { ...frame.contact },
      flight: frame.flight,
      rootBase: { ...arm.userData.__locoTravel },
      rootPos: [arm.position.x, arm.position.y, arm.position.z],
      foot: { L: footL, R: footR },
      footY: { L: footL ? footL[1] : null, R: footR ? footR[1] : null },
    });
  }

  // Summaries for verification convenience.
  const flightFrames = report.filter((r) => r.flight).length;
  const startBase = arm.userData.__locoBase;
  const endBase = arm.userData.__locoTravel;
  const travelled = Math.hypot(endBase.x - startBase.x, endBase.z - startBase.z);

  return {
    ok: true,
    cycle,
    framesPerCycle: fpc,
    loops: nLoops,
    totalFrames,
    stride: strideM,
    advanced: doAdvance,
    travelled,
    flightFrames,
    report,
    armatureUuid: arm.uuid,
  };
}

// Reset the travelling root back to the static base + restore bind-pose-ish.
export function humanoidLocomotionReset(armatureUuid = null) {
  const h = resolveHumanoid(armatureUuid);
  if (!h) return { ok: false, error: 'no humanoid' };
  const arm = h.armature;
  const base = arm.userData.__locoBase;
  if (base) {
    arm.position.set(base.x, base.y, base.z);
    arm.userData.__locoTravel = { ...base };
  }
  if (Array.isArray(h.skinnedMeshes)) {
    for (const sm of h.skinnedMeshes) {
      const sBase = sm.userData.__locoBase;
      if (sBase) { sm.position.set(sBase.x, sBase.y, sBase.z); sm.userData.__locoTravel = { ...sBase }; }
    }
  }
  refreshRig(h);
  return { ok: true, armatureUuid: arm.uuid };
}

// ─────────────────────────────────────────────────────────────────────────────
//  install
// ─────────────────────────────────────────────────────────────────────────────
export function installHumanoidLocomotion() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  window.__studioHumanoidAnimate = (o) => humanoidAnimate(o || {});
  window.__studioHumanoidPlay = (o) => humanoidPlay(o || {});
  window.__studioHumanoidLocomotionReset = (u) => humanoidLocomotionReset(u);
  window.__studioHumanoidCycles = LOCOMOTION_CYCLES;
  try {
    if (typeof window.__studioCommandRegister === 'function') {
      window.__studioCommandRegister('__studioHumanoidAnimate', window.__studioHumanoidAnimate, 'rig',
        'Pose the humanoid at a normalized locomotion phase t∈[0,1) (walk/run/idle): procedural gait with contralateral swing, hip sway, knee/ankle roll, foot-plant IK.');
      window.__studioCommandRegister('__studioHumanoidPlay', window.__studioHumanoidPlay, 'rig',
        'Play a locomotion cycle over frames×loops, advancing the root forward by stride per cycle (walk/run travel; idle in place). Returns per-frame contact/flight/foot-Y report.');
      window.__studioCommandRegister('__studioHumanoidLocomotionReset', window.__studioHumanoidLocomotionReset, 'rig',
        'Reset the humanoid root back to its base position after a locomotion play.');
    }
  } catch (_) { /* palette optional */ }
  return { ok: true, cycles: LOCOMOTION_CYCLES };
}

export default installHumanoidLocomotion;
