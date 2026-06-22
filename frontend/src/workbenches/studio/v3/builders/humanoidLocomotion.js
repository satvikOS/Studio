// ArchDisc Studio V3 — Humanoid LOCOMOTION cycles (WALK / RUN / JUMP / IDLE).
//
// Procedural, physically-motivated gait generators for the slice-682/humanoid.js
// rigged biped (58 bones: Pelvis, Spine1/2/3, Chest, Neck, Head, Jaw; per side
// Clavicle, Shoulder, Elbow, Wrist, Hand + 15 finger phalanges, and Hip, Knee,
// Ankle, Foot, Toe). A cycle is a pure function of a NORMALISED phase t ∈ [0,1)
// that returns, for that instant:
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
  Spine1: [[-0.35, 0.45], [-0.30, 0.30], [-0.30, 0.30]],
  Spine2: [[-0.35, 0.45], [-0.30, 0.30], [-0.30, 0.30]],
  Spine3: [[-0.35, 0.45], [-0.30, 0.30], [-0.30, 0.30]],
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
  Toe: [[-0.6, 0.9], [-0.1, 0.1], [-0.1, 0.1]],
  Clavicle: [[-0.3, 0.3], [-0.3, 0.3], [-0.5, 0.5]],
  Pelvis: [[-0.5, 0.5], [-0.6, 0.6], [-0.5, 0.5]],
};
// Finger / thumb phalanges share a curl-hinge limit (flex toward palm about
// local Z), matching humanoid.js so a clenched run-fist / relaxed walk-hand
// can't hyper-extend.
for (const dig of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) {
  for (let ph = 1; ph <= 3; ph++) JOINT_LIMITS[`${dig}${ph}`] = [[-0.1, 0.1], [-0.2, 0.2], [-1.7, 0.2]];
}

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

// ── EASING — replaces the old straight (linear / single-sine) swing curves so
//    limbs accelerate and decelerate naturally instead of moving at constant
//    angular speed. Real joints ease in at the start of a swing and ease out as
//    they decelerate toward a plant; quintic gives a crisp, athletic feel.
function easeInOutSine(u) { u = THREE.MathUtils.clamp(u, 0, 1); return -(Math.cos(Math.PI * u) - 1) / 2; }
function easeInOutQuint(u) {
  u = THREE.MathUtils.clamp(u, 0, 1);
  return u < 0.5 ? 16 * u * u * u * u * u : 1 - Math.pow(-2 * u + 2, 5) / 2;
}
function easeOutBack(u) {
  // overshoot-then-settle (limb plant overshoot + recoil). c=1.70158 std back.
  u = THREE.MathUtils.clamp(u, 0, 1);
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
}
// Eased fore/aft swing: a sine carrier shaped through an ease-in-out so the
// crossings (plants) decelerate and the apexes are crisp — non-constant angular
// velocity, the heart of organic motion.
function easedSwing(p, amp) {
  // map sine to an eased triangle: ease each half of the cycle separately.
  const s = Math.sin(p * TAU);
  const e = Math.sign(s) * easeInOutSine(Math.abs(s));
  return e * amp;
}

// Finger-curl euler set — curls every phalange (both hands) about local Z by
// `amt` (relaxed walk ≈ light cup; running ≈ tight fist). Thumb curls a touch
// less. dir flips the hinge sign per side so both hands close inward.
function fingerCurlBones(amt, thumbAmt) {
  const ta = thumbAmt == null ? amt * 0.6 : thumbAmt;
  const out = {};
  // Bind-pose finger bones have identity local frames (no rotation in T-pose),
  // so flexion toward the palm is NEGATIVE local-Z for BOTH hands (matching the
  // [-1.7, 0.2] curl-hinge limit). No per-side sign flip.
  for (const s of ['L', 'R']) {
    for (const dig of ['Index', 'Middle', 'Ring', 'Pinky']) {
      for (let ph = 1; ph <= 3; ph++) out[`${dig}${ph}.${s}`] = [0, 0, -amt];
    }
    for (let ph = 1; ph <= 3; ph++) out[`Thumb${ph}.${s}`] = [0, 0, -ta];
  }
  return out;
}

// Spread a total spine bend across the three vertebral bones so the back arcs.
function spineChain(ex, ey, ez) {
  const e = [ex / 3, ey / 3, ez / 3];
  return { Spine1: e.slice(), Spine2: e.slice(), Spine3: e.slice() };
}

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

  // Stance = first ~0.6 of each leg's phase, swing the rest.
  const DUTY = 0.6;
  const isStance = (p) => p < DUTY;
  // swing sub-phase 0..1 across the 0.4 swing window
  const swingU = (p) => (p < DUTY ? 0 : (p - DUTY) / (1 - DUTY));

  // hip flex/extend — EASED (non-constant angular velocity): the thigh
  // decelerates as it reaches forward (pre-heel-strike) and accelerates through
  // extension at push-off, rather than a constant-speed sine.
  const hipSwing = (p) => easedSwing(p, 0.62 * amp); // +forward, -back

  // knee: small flex during stance (loading absorb just after heel-strike),
  // then a big EASED flex through swing to clear the foot, easing OUT to a near-
  // straight leg just before plant (no stiff constant lift). Neg-X is flexion.
  const kneeFlex = (p) => {
    if (isStance(p)) {
      const su = p / DUTY;
      // weight-absorb dip right after contact (eased in), straighten for push.
      const absorb = easeInOutSine(THREE.MathUtils.clamp(su / 0.35, 0, 1)) *
                     (1 - easeInOutSine(THREE.MathUtils.clamp((su - 0.35) / 0.65, 0, 1)));
      return -(0.12 + 0.30 * absorb) * amp;
    }
    const su = swingU(p);
    // rise fast (ease-in-out quint), tuck at apex, ease OUT toward extension.
    const lift = Math.sin(easeInOutSine(su) * Math.PI);
    // slight OVERSHOOT on the plant — the lower leg snaps toward straight just
    // before heel-strike with a tiny recoil (easeOutBack >1 near the end), then
    // settles. Only in the final ~25 % of swing so it doesn't disturb clearance.
    const plant = (su > 0.75) ? (easeOutBack((su - 0.75) / 0.25) - 1) * 0.10 : 0;
    return -(0.28 + 1.10 * lift + plant) * amp;
  };

  // ankle + TOE heel-toe roll. Stance: heel-strike (dorsiflex, +X) → roll flat
  // → toe-off (plantarflex, -X). The TOE bone dorsiflexes late in stance so the
  // foot pivots over the ball (toe-off push) — real heel→ball→toe roll, eased.
  const ankle = (p) => {
    if (isStance(p)) {
      const su = p / DUTY;            // 0 heel-strike → 1 toe-off
      // +0.24 at heel-strike, eased through flat, to -0.44 plantarflex toe-off.
      return (0.24 * (1 - easeInOutSine(su)) - 0.44 * easeInOutQuint(su)) * amp;
    }
    const su = swingU(p);
    // swing: dorsiflex to clear the toe, ease back to the heel-strike angle.
    return (0.05 + 0.18 * bump(easeInOutSine(su))) * amp;
  };
  const toe = (p) => {
    if (isStance(p)) {
      const su = p / DUTY;
      // toes dorsiflex (+X) hard only in the last ~third of stance for toe-off,
      // eased in — the foot rolls over the ball before the foot leaves.
      const off = easeInOutQuint(THREE.MathUtils.clamp((su - 0.55) / 0.45, 0, 1));
      return 0.55 * off * amp;
    }
    // swing: relax toward neutral, tiny lift to clear ground.
    const su = swingU(p);
    return (0.10 * (1 - easeInOutSine(su))) * amp;
  };

  // arm swing — contralateral with FOLLOW-THROUGH. The shoulder leads; the
  // elbow + wrist LAG (a small phase delay) so the lower arm trails the upper
  // and overshoots at the swing reversals — classic secondary motion.
  const armSwing = 0.55 * amp;
  const LAG = 0.06; // ~6 % of a cycle of lag down the arm chain
  const shoulderL_x = -easedSwing(legPhaseR, armSwing);
  const shoulderR_x = -easedSwing(legPhaseL, armSwing);
  // elbow follow-through: flex driven by the LAGGED arm phase (trails shoulder).
  const elbowL = -(0.35 + 0.26 * Math.max(0, Math.sin((legPhaseR - LAG) * TAU))) * amp;
  const elbowR = (0.35 + 0.26 * Math.max(0, Math.sin((legPhaseL - LAG) * TAU))) * amp;
  // wrist LAG — the hand whips a beat behind the elbow (lagged again + scaled).
  const wristL = -0.22 * easedSwing(legPhaseR - 2 * LAG, 1) * amp;
  const wristR = 0.22 * easedSwing(legPhaseL - 2 * LAG, 1) * amp;

  // pelvis ROTATION (yaw, local Y) — twists toward the swing leg; the spine
  // CHAIN counter-rotates progressively (each vertebra unwinds a share) so the
  // shoulders stay facing forward through a smooth arc, not one twist.
  const pelvisYaw = easedSwing(t, 0.14 * amp);
  const counterTotal = -pelvisYaw * 1.0;     // shoulders fully counter the hips
  const chestCounter = -pelvisYaw * 0.15;
  // pelvis LATERAL sway (X) — weight shifts over the stance foot.
  const sway = Math.cos(t * TAU) * 0.018 * amp; // metres, root offset
  // pelvis DROP onto the swing-leg side (Trendelenburg list, local Z roll).
  const pelvisList = -Math.cos(t * TAU) * 0.06 * amp;

  // vertical BOB — COM rises at MID-STANCE (single-support, straight stance leg
  // pushes the body up) and dips at double-support (heel-strikes, knee-absorb
  // DIP). Contact at t≈0/0.5, mid-stance at t≈0.25/0.75 → use -cos(2·) so the
  // peak lands at mid-stance, the trough at contact. 2× cadence.
  const bob = (-Math.cos(2 * t * TAU) * 0.5 + 0.5) * 0.024 * amp - 0.012 * amp;
  // subtle fore/aft drift of the COM as the trailing leg pushes.
  const lean = Math.sin(2 * t * TAU) * 0.006 * amp;

  // head SETTLE / damping — the head lags + counters the bob and list with a
  // little inertia (a phase-delayed, scaled counter) so it floats level instead
  // of bobbing rigidly with the chest.
  const headPitch = -bob * 1.4 + 0.02 * Math.sin((t - 0.08) * 2 * TAU) * amp;
  const headRoll = -pelvisList * 0.45;
  const headYaw = -pelvisYaw * 0.25; // gaze stabilises against the twist

  const bones = {
    Pelvis: [0, pelvisYaw, pelvisList],
    ...spineChain(0.05 * amp, counterTotal, 0),
    Chest: [0.03 * amp, chestCounter, 0],
    Neck: [0.03 * amp, headYaw * 0.4, 0],
    Head: [headPitch, headYaw, headRoll],

    'Hip.L': [hipSwing(legPhaseL), 0, 0],
    'Knee.L': [kneeFlex(legPhaseL), 0, 0],
    'Ankle.L': [ankle(legPhaseL), 0, 0],
    'Toe.L': [toe(legPhaseL), 0, 0],
    'Hip.R': [hipSwing(legPhaseR), 0, 0],
    'Knee.R': [kneeFlex(legPhaseR), 0, 0],
    'Ankle.R': [ankle(legPhaseR), 0, 0],
    'Toe.R': [toe(legPhaseR), 0, 0],

    'Shoulder.L': [shoulderL_x, 0, ARM_DOWN_L_Z],
    'Elbow.L': [0, 0, elbowL],
    'Wrist.L': [0, 0, wristL],
    'Shoulder.R': [shoulderR_x, 0, ARM_DOWN_R_Z],
    'Elbow.R': [0, 0, elbowR],
    'Wrist.R': [0, 0, wristR],
    'Clavicle.L': [0, 0, 0],
    'Clavicle.R': [0, 0, 0],
    // hands relaxed / lightly cupped while walking.
    ...fingerCurlBones(0.30 * amp),
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

  // bigger EASED hip swing (longer, athletic stride; non-constant velocity).
  const hipSwing = (p) => easedSwing(p, 0.95 * amp);
  // much bigger knee lift in swing; strong EASED flex on landing absorb (the
  // weight drop) then a powerful eased-out drive.
  const kneeFlex = (p) => {
    if (isStance(p)) {
      const su = p / DUTY;
      // deep landing absorb eased-in on contact, driving straighter for push.
      const absorb = Math.sin(easeInOutSine(su) * Math.PI);
      return -(0.30 + 0.55 * absorb) * amp;
    }
    const su = swingU(p);
    const lift = Math.sin(easeInOutQuint(su) * Math.PI); // hard, crisp tuck
    // crisp plant overshoot — the leg whips toward extension with a small recoil.
    const plant = (su > 0.78) ? (easeOutBack((su - 0.78) / 0.22) - 1) * 0.14 : 0;
    return -(0.45 + 1.65 * lift + plant) * amp;
  };
  // ankle + toe: forefoot strike → strong plantarflex push; toe drives the
  // push-off (sprinter forefoot mechanics), eased.
  const ankle = (p) => {
    if (isStance(p)) {
      const su = p / DUTY;
      return (0.14 * (1 - easeInOutSine(su)) - 0.52 * easeInOutQuint(su)) * amp;
    }
    const su = swingU(p);
    return (0.12 + 0.26 * bump(easeInOutSine(su))) * amp;
  };
  const toe = (p) => {
    if (isStance(p)) {
      const su = p / DUTY;
      const off = easeInOutQuint(THREE.MathUtils.clamp((su - 0.4) / 0.6, 0, 1));
      return 0.72 * off * amp; // hard toe drive
    }
    const su = swingU(p);
    return (0.14 * (1 - easeInOutSine(su))) * amp;
  };

  // arms: big EASED swing, elbows pinned near 90° (sprinter form) with a small
  // FOLLOW-THROUGH lag down to the wrist so the hands whip at the swing tops.
  const armSwing = 0.95 * amp;
  const LAG = 0.05;
  const shoulderL_x = -easedSwing(legPhaseR, armSwing) - 0.15 * amp;
  const shoulderR_x = -easedSwing(legPhaseL, armSwing) - 0.15 * amp;
  const elbowL = -(1.45); // ~90° (rad), held
  const elbowR = (1.45);
  const wristL = -0.30 * easedSwing(legPhaseR - 2 * LAG, 1) * amp;
  const wristR = 0.30 * easedSwing(legPhaseL - 2 * LAG, 1) * amp;

  const pelvisYaw = easedSwing(t, 0.20 * amp);
  const counterTotal = -pelvisYaw * 1.0; // shoulders counter the hips (spine chain)
  const chestCounter = -pelvisYaw * 0.2;
  const sway = Math.cos(t * TAU) * 0.022 * amp;
  const pelvisList = -Math.cos(t * TAU) * 0.08 * amp;

  // bigger vertical bob; centre raised so the flight apex clearly leaves the
  // floor. COM peaks at MID-STANCE/flight-apex (push-off RISE → flight) and
  // dips at contact (landing DIP) → -cos(2·) puts the peak at mid-stance.
  const bob = (-Math.cos(2 * t * TAU) * 0.5 + 0.5) * 0.055 * amp + 0.005 * amp;
  const lean = Math.sin(2 * t * TAU) * 0.012 * amp;

  // forward TORSO LEAN — constant pitch into the run (spine chain + chest + hip).
  const torsoLean = 0.28 * amp;

  // head SETTLE — leads the lean a touch and damps the bob with a phase lag.
  const headPitch = -bob * 1.1 + 0.06 * amp + 0.02 * Math.sin((t - 0.08) * 2 * TAU) * amp;
  const headRoll = -pelvisList * 0.4;
  const headYaw = -pelvisYaw * 0.25;

  const stanceL = isStance(legPhaseL);
  const stanceR = isStance(legPhaseR);
  const bones = {
    Pelvis: [0.06 * amp, pelvisYaw, pelvisList],
    ...spineChain(torsoLean * 0.85, counterTotal, 0),
    Chest: [torsoLean * 0.4, chestCounter, 0],
    Neck: [0.06 * amp, headYaw * 0.4, 0],
    Head: [headPitch, headYaw, headRoll],

    'Hip.L': [hipSwing(legPhaseL), 0, 0],
    'Knee.L': [kneeFlex(legPhaseL), 0, 0],
    'Ankle.L': [ankle(legPhaseL), 0, 0],
    'Toe.L': [toe(legPhaseL), 0, 0],
    'Hip.R': [hipSwing(legPhaseR), 0, 0],
    'Knee.R': [kneeFlex(legPhaseR), 0, 0],
    'Ankle.R': [ankle(legPhaseR), 0, 0],
    'Toe.R': [toe(legPhaseR), 0, 0],

    'Shoulder.L': [shoulderL_x, 0, ARM_DOWN_L_Z],
    'Elbow.L': [0, 0, elbowL],
    'Wrist.L': [0, 0, wristL],
    'Shoulder.R': [shoulderR_x, 0, ARM_DOWN_R_Z],
    'Elbow.R': [0, 0, elbowR],
    'Wrist.R': [0, 0, wristR],
    'Clavicle.L': [0, 0, 0],
    'Clavicle.R': [0, 0, 0],
    // hands held in a relaxed running FIST (tighter than the walk cup).
    ...fingerCurlBones(0.95 * amp, 0.6 * amp),
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
    ...spineChain(0.04 * amp, 0, 0),
    Chest: [0.02 * amp + chestBreath, 0, 0],
    Neck: [0.05 * amp, headYaw * 0.3, 0],
    Head: [0.0, headYaw, headRoll],

    'Hip.L': [0.04 * amp, 0, 0.02 * amp],
    'Knee.L': [kneeL, 0, 0],
    'Ankle.L': [0.02 * amp, 0, 0],
    'Toe.L': [0, 0, 0],
    'Hip.R': [0.04 * amp, 0, -0.02 * amp],
    'Knee.R': [kneeR, 0, 0],
    'Ankle.R': [0.02 * amp, 0, 0],
    'Toe.R': [0, 0, 0],

    'Shoulder.L': [microL, 0, ARM_DOWN_L_Z + 0.03 * amp],
    'Elbow.L': [0, 0, -0.30 * amp],
    'Wrist.L': [0, 0, 0],
    'Shoulder.R': [microR, 0, ARM_DOWN_R_Z - 0.03 * amp],
    'Elbow.R': [0, 0, 0.30 * amp],
    'Wrist.R': [0, 0, 0],
    'Clavicle.L': [0, 0, 0],
    'Clavicle.R': [0, 0, 0],
    // hands lightly relaxed at rest.
    ...fingerCurlBones(0.22 * amp),
  };

  return {
    bones,
    root: { x: sway, y: bob, z: 0 },
    contact: { L: true, R: true },
    flight: false,
  };
}

// ── JUMP ───────────────────────────────────────────────────────────────────
// A single bound, expressed over phase t∈[0,1) so it plugs into the same
// transport/play machinery as the loops. Five biomechanical stages:
//
//   PREP/STAND  t∈[0.00,0.12)  — quiet stand settling into the load.
//   CROUCH      t∈[0.12,0.30)  — countermovement: hips/knees/ankles flex deeply
//                                 (load the legs), torso pitches forward, arms
//                                 swing BACK behind the body (wind-up).
//   LAUNCH      t∈[0.30,0.42)  — explosive triple extension: hips/knees drive
//                                 straight, ankles plantarflex (toe-off), arms
//                                 throw UP+forward overhead — the propulsive push.
//   FLIGHT      t∈[0.42,0.66)  — BOTH FEET OFF the ground. COM follows a true
//                                 BALLISTIC parabola (gravity), peaking at the
//                                 apex; legs tuck (knees up) then begin to reach
//                                 for landing; arms held high for balance.
//   LAND        t∈[0.66,0.82)  — touchdown + ABSORB: knees/hips/ankles flex hard
//                                 to soak the impact (eccentric), arms drop
//                                 forward for balance, torso folds slightly.
//   RECOVER     t∈[0.82,1.00)  — rise back to a relaxed stand, arms settle.
//
// The vertical arc is REAL: during flight root.y traces y = v0·τ − ½g·τ²
// (τ the flight-normalised time), so the apex height and the up/down symmetry
// are physical rather than a hand-keyed bump. contact={L,R}=false only across
// the flight window (flight flag true there) — exactly the both-feet-off cue.
function jumpCycle(t, opts = {}) {
  t = wrap01(t);
  const amp = opts.amp == null ? 1 : opts.amp;
  const peak = (opts.jumpHeight == null ? 0.55 : opts.jumpHeight) * amp; // apex COM rise (m)

  // stage boundaries
  const T_CROUCH = 0.12, T_LAUNCH = 0.30, T_TAKEOFF = 0.42, T_LAND = 0.66, T_DOWN = 0.82;
  const seg = (a, b) => THREE.MathUtils.clamp((t - a) / (b - a), 0, 1); // 0..1 within a stage

  // ── COM vertical (root.y). Crouch dips the COM (−), launch shoots it up, the
  //    flight phase is a clean ballistic parabola peaking at flight-midpoint,
  //    landing dips again (absorb), recovery returns to 0.
  const crouchDip = -0.26 * amp;     // how far the COM sinks in the countermovement
  const landDip = -0.30 * amp;       // absorb depth on touchdown
  let comY = 0;
  let flight = false;
  if (t < T_CROUCH) {
    comY = easeInOutSine(seg(0, T_CROUCH)) * (crouchDip * 0.4); // begin sinking
  } else if (t < T_LAUNCH) {
    // deep crouch hold → start of drive: ease to the bottom then begin rising.
    const u = seg(T_CROUCH, T_LAUNCH);
    comY = crouchDip * (1 - easeInOutSine(Math.max(0, u - 0.5) / 0.5) * 0.2);
  } else if (t < T_TAKEOFF) {
    // launch: drive the COM up from the crouch bottom toward 0 (leaving ground).
    const u = seg(T_LAUNCH, T_TAKEOFF);
    comY = crouchDip * (1 - easeInOutQuint(u)); // rises crouchDip→0 by takeoff
  } else if (t < T_LAND) {
    // FLIGHT — true parabola. τ∈[0,1] across the flight window; symmetric arc
    // y = 4·peak·τ·(1−τ) (a clean parabola, 0 at both ends, peak at τ=0.5).
    const tau = seg(T_TAKEOFF, T_LAND);
    comY = 4 * peak * tau * (1 - tau);
    flight = true;
  } else if (t < T_DOWN) {
    // landing absorb: from 0 (touchdown) dip to landDip then start back up.
    const u = seg(T_LAND, T_DOWN);
    comY = landDip * Math.sin(easeInOutSine(u) * Math.PI); // dip-and-return bump
  } else {
    // recover to stand.
    comY = landDip * 0.15 * (1 - easeInOutSine(seg(T_DOWN, 1)));
  }

  // ── leg flexion driving the COM. Knees/hips/ankles flex with the crouch +
  //    landing absorb, extend through launch, tuck in flight.
  let hip = 0, knee = 0, ankle = 0, toe = 0, torso = 0;
  if (t < T_CROUCH) {
    const u = easeInOutSine(seg(0, T_CROUCH));
    knee = -0.5 * u; hip = -0.35 * u; ankle = 0.22 * u; torso = 0.18 * u;
  } else if (t < T_LAUNCH) {
    // hold deep crouch (max load), begin to unload near the end.
    const u = seg(T_CROUCH, T_LAUNCH);
    const deep = 1 - 0.25 * easeInOutSine(Math.max(0, u - 0.6) / 0.4);
    knee = -1.25 * deep; hip = -0.95 * deep; ankle = 0.45 * deep; torso = 0.34 * deep;
  } else if (t < T_TAKEOFF) {
    // EXPLOSIVE extension: legs straighten, ankles plantarflex (toe-off).
    const u = easeInOutQuint(seg(T_LAUNCH, T_TAKEOFF));
    knee = -1.25 * (1 - u) - 0.05; hip = -0.95 * (1 - u);
    ankle = 0.45 * (1 - u) - 0.5 * u; toe = 0.6 * u; torso = 0.34 * (1 - u) + 0.06;
  } else if (t < T_LAND) {
    // FLIGHT: tuck the knees up early (legs lift), then reach down for landing.
    const tau = seg(T_TAKEOFF, T_LAND);
    const tuck = Math.sin(tau * Math.PI);            // peaks mid-flight
    const reach = easeInOutSine(Math.max(0, tau - 0.55) / 0.45); // extend legs late
    knee = -(0.25 + 1.5 * tuck) * (1 - reach) - 0.15 * reach;
    hip = 0.55 * tuck * (1 - reach) - 0.10 * reach;  // thighs up at apex
    ankle = 0.25 - 0.15 * reach; toe = 0.15;
    torso = 0.12 + 0.10 * tuck;
  } else if (t < T_DOWN) {
    // LAND ABSORB: deep eccentric flex then unfold.
    const u = Math.sin(easeInOutSine(seg(T_LAND, T_DOWN)) * Math.PI);
    knee = -(0.15 + 1.0 * u); hip = -(0.10 + 0.7 * u); ankle = 0.1 + 0.45 * u;
    torso = 0.10 + 0.30 * u; toe = 0.1 * (1 - u);
  } else {
    // RECOVER to relaxed stand.
    const u = 1 - easeInOutSine(seg(T_DOWN, 1));
    knee = -(0.15 * u) - 0.05; hip = -0.10 * u; ankle = 0.1 * u; torso = 0.10 * u;
  }

  // ── ARMS. Wind back in crouch → throw overhead through launch + flight →
  //    drop forward on landing → settle. Shoulder X is the swing (forward = neg
  //    for the left convention used elsewhere); overhead = a large negative pitch
  //    that raises both arms in front/up. Symmetric (both arms together).
  // shoulderSwing: negative pitches the arm forward/up from the down rest.
  let armPitch = 0;   // both shoulders, added to ARM_DOWN rest
  let elbow = 0.3;    // mild bend at rest
  if (t < T_CROUCH) {
    const u = easeInOutSine(seg(0, T_CROUCH));
    armPitch = 0.5 * u;   // swing arms BACK (positive = behind body) — wind-up start
    elbow = 0.3 + 0.3 * u;
  } else if (t < T_LAUNCH) {
    const u = seg(T_CROUCH, T_LAUNCH);
    armPitch = 0.8 - 0.3 * easeInOutSine(Math.max(0, u - 0.5) / 0.5); // held back, begin forward
    elbow = 0.6;
  } else if (t < T_TAKEOFF) {
    // throw arms UP+overhead with the launch.
    const u = easeInOutQuint(seg(T_LAUNCH, T_TAKEOFF));
    armPitch = 0.5 - 2.6 * u;  // sweep from behind to high overhead (neg = up/front)
    elbow = 0.6 - 0.45 * u;    // straighten as they reach up
  } else if (t < T_LAND) {
    // arms held HIGH for balance through flight, easing down toward the end.
    const tau = seg(T_TAKEOFF, T_LAND);
    armPitch = -2.1 + 0.9 * easeInOutSine(Math.max(0, tau - 0.4) / 0.6);
    elbow = 0.15 + 0.25 * tau;
  } else if (t < T_DOWN) {
    // drop arms forward/down to catch balance on landing.
    const u = easeInOutSine(seg(T_LAND, T_DOWN));
    armPitch = -1.2 + 1.2 * u;  // come down to ~level/forward
    elbow = 0.4 + 0.3 * Math.sin(u * Math.PI);
  } else {
    const u = 1 - easeInOutSine(seg(T_DOWN, 1));
    armPitch = 0.0 + 0.0 * u; elbow = 0.3;
  }

  const stance = !flight; // both feet planted whenever not in flight
  const spineBend = torso; // forward torso fold spread across the spine chain
  const bones = {
    Pelvis: [torso * 0.3, 0, 0],
    ...spineChain(spineBend * 0.7, 0, 0),
    Chest: [spineBend * 0.4, 0, 0],
    Neck: [0.04 * amp, 0, 0],
    // head looks slightly up through the launch/flight (toward the apex), folds
    // down a touch on landing.
    Head: [(-armPitch * 0.06) - spineBend * 0.3, 0, 0],

    'Hip.L': [hip, 0, 0],
    'Knee.L': [knee, 0, 0],
    'Ankle.L': [ankle, 0, 0],
    'Toe.L': [toe, 0, 0],
    'Hip.R': [hip, 0, 0],
    'Knee.R': [knee, 0, 0],
    'Ankle.R': [ankle, 0, 0],
    'Toe.R': [toe, 0, 0],

    // both arms move together (a two-foot vertical jump): shoulder X = rest swing.
    'Shoulder.L': [armPitch, 0, ARM_DOWN_L_Z],
    'Elbow.L': [0, 0, -elbow],
    'Wrist.L': [0, 0, 0],
    'Shoulder.R': [armPitch, 0, ARM_DOWN_R_Z],
    'Elbow.R': [0, 0, elbow],
    'Wrist.R': [0, 0, 0],
    'Clavicle.L': [0, 0, 0],
    'Clavicle.R': [0, 0, 0],
    // hands relaxed-open through the air, light cup on the crouch/land.
    ...fingerCurlBones(flight ? 0.10 * amp : 0.30 * amp),
  };

  return {
    bones,
    root: { x: 0, y: comY, z: 0 },
    contact: { L: stance, R: stance },
    flight,
  };
}

const CYCLES = { walk: walkCycle, run: runCycle, jump: jumpCycle, idle: idleCycle };
export const LOCOMOTION_CYCLES = Object.keys(CYCLES);

// Per-cycle default forward stride (metres travelled per full cycle) + cadence.
const CYCLE_DEFAULTS = {
  walk: { stride: 0.75, cadenceFps: 24, framesPerCycle: 30 },
  run: { stride: 1.5, cadenceFps: 24, framesPerCycle: 20 }, // 1.5 m keeps the planted foot within reach (slide <6cm) while staying athletic
  // jump: a forward BOUND — the body travels ~1.4 m over the single arc, most of
  // it during the flight window. Stride is applied across the cycle by the play
  // loop; the ballistic Y arc handles the vertical, so this gives the bound a
  // forward distance (a standing-broad-jump feel) while staying believable.
  jump: { stride: 1.4, cadenceFps: 24, framesPerCycle: 48 },
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
        // 3 passes of high-iteration CCD pin the ankle tightly even under the
        // run's larger COM bob + stride (otherwise the short run stance can let
        // the foot drift a couple cm before convergence).
        window.__studioRigSolveIK(ankle.uuid, target, 30, 2);
        window.__studioRigSolveIK(ankle.uuid, target, 30, 2);
        window.__studioRigSolveIK(ankle.uuid, target, 30, 2);
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
  // so a stand-alone Animate call still grounds the stance foot. SKIP for run
  // (handled by the play loop's rolling anchors) and for jump (the ballistic COM
  // arc must lift the whole body — in-place ankle IK would fight the rise/fall
  // and pin a scrubbed flight frame's feet to the floor instead of in the air).
  if (plant && cycle !== 'run' && cycle !== 'jump') {
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
  continueTravel = false,   // resume from the current travelled position instead
                            // of snapping the root back to base — lets a SEQUENCE
                            // (walk → run → jump) keep advancing down the street.
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

  // Establish the travelling base from the armature's static base. With
  // continueTravel the existing __locoTravel is KEPT (the figure resumes from
  // where the previous clip left it), so chaining clips traverses the street;
  // otherwise it resets to the static base (single-clip behaviour, unchanged).
  const arm = h.armature;
  if (!arm.userData.__locoBase) {
    arm.userData.__locoBase = { x: arm.position.x, y: arm.position.y, z: arm.position.z };
  }
  const startTravel = (continueTravel && arm.userData.__locoTravel)
    ? { ...arm.userData.__locoTravel } : { ...arm.userData.__locoBase };
  arm.userData.__locoTravel = { ...startTravel };
  if (Array.isArray(h.skinnedMeshes)) {
    for (const sm of h.skinnedMeshes) {
      if (!sm.userData.__locoBase) sm.userData.__locoBase = { x: sm.position.x, y: sm.position.y, z: sm.position.z };
      sm.userData.__locoTravel = (continueTravel && sm.userData.__locoTravel)
        ? { ...sm.userData.__locoTravel }
        : { ...sm.userData.__locoBase };
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

    // foot-plant for stance feet (walk grounds both; run plants whichever is
    // down). SKIP for jump: the ballistic COM arc (root.y) raises/lowers the
    // whole body and the leg pose drives crouch/tuck/absorb — pinning the ankle
    // back to a captured anchor would flatten the arc and fight the launch/land
    // mechanics. The contact flags + arc already produce correct grounding.
    if (plant && cycle !== 'jump') plantStanceFeet(h, frame, anchors);

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
  const staticBase = arm.userData.__locoBase;
  const endBase = arm.userData.__locoTravel;
  // total displacement from the static spawn (cumulative across a sequence)…
  const travelled = Math.hypot(endBase.x - staticBase.x, endBase.z - staticBase.z);
  // …and the distance covered by THIS clip alone (from where it started).
  const segmentTravelled = Math.hypot(endBase.x - startTravel.x, endBase.z - startTravel.z);

  return {
    ok: true,
    cycle,
    continued: !!continueTravel,
    segmentTravelled,
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

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC: walk-path — drive the PROCEDURAL humanoid along a CatmullRom path.
// ─────────────────────────────────────────────────────────────────────────────
//  window.__studioHumanoidWalkPath({ path, speed, ... })
//
//  Goal (the brief): advance the PROCEDURAL implicit-surface humanoid (built by
//  __studioBuildHumanoid — NO glb, NO Mixamo) along a CatmullRom path through the
//  forest clearing, FACING the heading, FOOT-PLANTING on the sampled terrain, and
//  driving the PROCEDURAL walk cycle (humanoidLocomotion.walkCycle — heel-toe,
//  weight-shift, opposed arm-swing, secondary motion) STRIDE-LOCKED to travel
//  distance so there is NO foot-slide.
//
//  HOW it differs from humanoidPlay: humanoidPlay translates the root in a
//  straight line along one fixed axis. A PATH curves, so here we place the figure
//  at the arc-length point on the curve, YAW it to the tangent, and add the
//  cycle's root bob/sway/lean in the figure's LOCAL frame (rotated by heading).
//  The bind pose faces +Z (legs swing fore/aft about local X in the XZ plane), so
//  aligning local +Z onto the tangent (yaw = atan2(tan.x, tan.z)) makes the gait
//  point down the path. STRIDE LOCK: phase = (distanceAlong / strideMeters) wrapped
//  — exactly one stride-pair of cycle phase per `strideMeters` of ground, so the
//  planted foot stays put (the same cadence law as the mocap driver, but driving
//  the PROCEDURAL cycle). FOOT-PLANT: per step the figure's base Y is set to the
//  terrain height under its XZ (analytic __studioTerrainHeight, else a downward
//  raycast against the tagged terrain mesh, else y=0) plus the cycle bob, so feet
//  ride the relief — and the stance-foot IK (plantStanceFeet) pins the planted
//  ankle so it doesn't slide as the body advances/curves.
//
//  Pure scene mutation (no setState). Reuses walkCycle / applyCyclePose's bone
//  pass + plantStanceFeet; only the TRANSPORT (curve placement + heading + local-
//  frame root offset) is new. Returns a per-step report for headless verify.

// Resolve a terrain-height sampler (x,z)->y: prefer the analytic nature sampler,
// else a downward raycast against the tagged terrain mesh, else flat y=0. Mirrors
// the mocap driver so the procedural figure foot-plants on the SAME relief.
function makeTerrainSampler(scene) {
  if (typeof window !== 'undefined' && typeof window.__studioTerrainHeight === 'function') {
    return { fn: (x, z) => Number(window.__studioTerrainHeight(x, z)) || 0, mode: 'analytic' };
  }
  let terrainMesh = null;
  if (scene) scene.traverse((o) => {
    if (!terrainMesh && o.isMesh && o.userData && (o.userData.archdiscTerrain || o.userData.studioMaterial === 'grass')) {
      terrainMesh = o;
    }
  });
  if (terrainMesh) {
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const from = new THREE.Vector3();
    return {
      fn: (x, z) => {
        from.set(x, 1e4, z);
        ray.set(from, down);
        const hits = ray.intersectObject(terrainMesh, true);
        return hits.length ? hits[0].point.y : 0;
      },
      mode: 'raycast',
    };
  }
  return { fn: () => 0, mode: 'flat' };
}

// Apply ONLY the cycle's bone pose (no transform) to the humanoid at phase t.
// The walk-path driver owns the transform (curve placement + heading + local-
// frame bob/sway), so we skip applyCyclePose's straight-line root translation.
function applyCycleBones(h, frame) {
  const boneMap = mapByName(h.boneList);
  for (const b of h.boneList) b.rotation.set(0, 0, 0);
  for (const name of Object.keys(frame.bones)) {
    const b = boneMap[name];
    if (!b) continue;
    const e = clampEuler(name, frame.bones[name]);
    b.rotation.set(e[0], e[1], e[2]);
  }
}

// Place the figure (armature + sibling skinned meshes) at world position `pos`
// with heading yaw `yaw`. The cycle root offset (local sway/bob/lean) is rotated
// into world by the heading and added on top of `pos`. Keeps the meshes in
// lock-step with the armature (they're scene siblings at the same world origin).
function placeFigure(h, pos, yaw, rootLocal) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  // rotate the local (x=lateral, z=forward) offset by yaw about +Y into world.
  const lx = rootLocal ? (rootLocal.x || 0) : 0;
  const lz = rootLocal ? (rootLocal.z || 0) : 0;
  const wx = lx * cy + lz * sy;
  const wz = -lx * sy + lz * cy;
  const wy = rootLocal ? (rootLocal.y || 0) : 0;
  const fx = pos.x + wx, fy = pos.y + wy, fz = pos.z + wz;
  const arm = h.armature;
  arm.position.set(fx, fy, fz);
  arm.rotation.y = yaw;
  if (Array.isArray(h.skinnedMeshes)) {
    for (const sm of h.skinnedMeshes) {
      sm.position.set(fx, fy, fz);
      sm.rotation.y = yaw;
    }
  }
}

export function humanoidWalkPath({
  path = null,
  speed = 1.4,            // m/s — relaxed adult walk pace
  strideMeters = null,    // ground covered per full walk cycle (one stride-pair)
  amp = 1,                // gait amplitude (stride scale)
  steps = null,           // total samples across the whole path (default ~ length/0.05)
  plant = true,           // stance-foot IK pin (no foot-slide)
  closed = false,         // closed loop path?
  armatureUuid = null,
  transportName = 'walk-path',
  registerTransport = true,
} = {}) {
  const h = resolveHumanoid(armatureUuid);
  if (!h || !h.boneList || !h.boneList.length) {
    return { ok: false, error: 'no humanoid built yet (call __studioBuildHumanoid first)' };
  }
  const scene = getScene();
  const sampler = makeTerrainSampler(scene);

  // Default path: a gentle S-curve through the clearing if none supplied.
  let pts = Array.isArray(path) ? path : null;
  if (!pts || pts.length < 2) {
    pts = [[-8, 0, -6], [-3, 0, -1], [2, 0, 2], [7, 0, 5]];
  }
  // Build the curve in XZ; sample terrain Y per control point so the centreline
  // already hugs the ground (the per-step plant then refines the exact foot Y).
  const curvePts = pts.map((p) => {
    const x = Number(p[0]) || 0, z = Number(p[2]) || 0;
    const y = Number.isFinite(p[1]) && p[1] !== 0 ? Number(p[1]) : sampler.fn(x, z);
    return new THREE.Vector3(x, y, z);
  });
  const curve = new THREE.CatmullRomCurve3(curvePts, !!closed, 'catmullrom', 0.5);
  const pathLength = curve.getLength();

  // STRIDE LOCK — one full walk cycle = one stride-pair (two steps). Cadence is
  // chosen so the cycle phase advances by exactly one cycle per `strideMeters` of
  // ground, which is what keeps the planted foot from sliding. Default 0.75 m
  // matches CYCLE_DEFAULTS.walk.stride (the per-cycle travel humanoidPlay uses).
  const stride = Number(strideMeters) > 0 ? Number(strideMeters)
    : (CYCLE_DEFAULTS.walk.stride || 0.75);
  const cyclesTotal = pathLength / stride;     // walk cycles over the whole path
  const travelSeconds = pathLength / Math.max(1e-3, speed);

  // Capture each humanoid object's STATIC base so the path driver can restore it
  // (and so a later humanoidPlay still sees a sane __locoBase).
  const arm = h.armature;
  if (!arm.userData.__locoBase) {
    arm.userData.__locoBase = { x: arm.position.x, y: arm.position.y, z: arm.position.z };
  }
  if (Array.isArray(h.skinnedMeshes)) {
    for (const sm of h.skinnedMeshes) {
      if (!sm.userData.__locoBase) sm.userData.__locoBase = { x: sm.position.x, y: sm.position.y, z: sm.position.z };
    }
  }

  // Rolling stance-foot anchors (persist across advance() calls so a planted
  // foot stays pinned for the whole stance it's down, even as we curve).
  const anchors = { L: null, R: null, groundY: null };

  const _pos = new THREE.Vector3();
  const _tan = new THREE.Vector3();

  // advance(u): place + pose the figure at normalized path parameter u∈[0,1].
  //  • position  = curve point at u, foot-planted to terrain Y
  //  • heading    = yaw to the path tangent (figure forward = local +Z)
  //  • gait phase = stride-locked (distanceAlong / stride), wrapped → no slide
  // Returns { x,y,z (ground contact), heading, phase, contact } for verify.
  function advance(u) {
    const uu = Math.min(1, Math.max(0, Number(u) || 0));
    curve.getPointAt(uu, _pos);
    const groundY = sampler.fn(_pos.x, _pos.z);

    // heading: yaw so the figure's forward (+Z local) points down the tangent.
    curve.getTangentAt(Math.min(0.9999, uu), _tan);
    _tan.y = 0;
    const yaw = _tan.lengthSq() < 1e-8 ? (h.armature.rotation.y || 0)
      : Math.atan2(_tan.x, _tan.z);

    // stride-locked phase from distance along the path.
    const distAlong = pathLength * uu;
    const phase = wrap01(distAlong / stride);
    const frame = walkCycle(phase, { amp });

    // bone pose (gait), then place the figure on the ground at the curve point
    // with the heading; the cycle's local bob/sway/lean rides the placement.
    applyCycleBones(h, frame);
    placeFigure(h, { x: _pos.x, y: groundY, z: _pos.z }, yaw, frame.root);
    refreshRig(h);

    // foot-plant: pin the stance foot at its captured ground anchor so it does
    // not slide as the body advances + curves (hip/knee drop toward the plant).
    if (plant) plantStanceFeet(h, frame, anchors);

    return {
      x: _pos.x, y: groundY, z: _pos.z,
      heading: yaw, phase, u: uu,
      contact: { ...frame.contact },
    };
  }

  // Pose at the start so the figure is grounded + mid-stride immediately.
  advance(0);

  // Register a TRANSPORT clip whose fn(t) advances along the path (t→u directly,
  // one transport loop = one full traversal). Lets the demo play/scrub it, and is
  // the same surface the CUA reaches by pressing play.
  if (registerTransport && typeof window !== 'undefined' && window.__studioAnimPlayer
      && typeof window.__studioAnimPlayer.registerClip === 'function') {
    window.__studioAnimPlayer.registerClip(transportName, (t) => {
      advance(wrap01(t));
      return { ok: true };
    }, { seconds: Math.max(0.5, travelSeconds) });
  }

  // Expose the direct driver + info (offline capture / verify can call advance).
  if (typeof window !== 'undefined') {
    window.__studioHumanoidWalkAdvance = advance;
    window.__studioHumanoidWalkPathInfo = {
      pathLength, stride, cyclesTotal, travelSeconds, speed,
      footPlant: sampler.mode, points: pts.length, procedural: true,
    };
  }

  // Build a per-step report (phase, contact, position, foot world-Y) for headless
  // verification — proves advance, foot-plant, heading, and stride-lock without a
  // renderer. nSteps spans the whole path at ~5 cm resolution by default.
  const nSteps = Math.max(8, Math.floor(steps || Math.max(24, pathLength / 0.05)));
  const report = [];
  const boneMap = mapByName(h.boneList);
  const wpL = new THREE.Vector3(), wpR = new THREE.Vector3();
  for (let i = 0; i <= nSteps; i++) {
    const u = i / nSteps;
    const a = advance(u);
    h.armature.updateMatrixWorld(true);
    const aL = boneMap['Ankle.L'], aR = boneMap['Ankle.R'];
    let footL = null, footR = null;
    if (aL) { aL.getWorldPosition(wpL); footL = [wpL.x, wpL.y, wpL.z]; }
    if (aR) { aR.getWorldPosition(wpR); footR = [wpR.x, wpR.y, wpR.z]; }
    report.push({
      step: i, u, phase: a.phase, heading: a.heading,
      pos: [a.x, a.y, a.z],
      contact: a.contact,
      foot: { L: footL, R: footR },
      footY: { L: footL ? footL[1] : null, R: footR ? footR[1] : null },
    });
  }

  return {
    ok: true,
    cycle: 'walk',
    procedural: true,
    armatureUuid: arm.uuid,
    curve,
    advance,
    path: pts,
    pathLength,
    stride,
    cyclesTotal,
    travelSeconds,
    speed,
    footPlant: sampler.mode,
    transportName: (registerTransport ? transportName : null),
    report,
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
  arm.rotation.y = 0; // the walk-path driver yaws the figure to the heading — undo it
  if (Array.isArray(h.skinnedMeshes)) {
    for (const sm of h.skinnedMeshes) {
      const sBase = sm.userData.__locoBase;
      if (sBase) { sm.position.set(sBase.x, sBase.y, sBase.z); sm.userData.__locoTravel = { ...sBase }; }
      sm.rotation.y = 0;
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
  window.__studioHumanoidWalkPath = (o) => humanoidWalkPath(o || {});
  window.__studioHumanoidLocomotionReset = (u) => humanoidLocomotionReset(u);
  window.__studioHumanoidCycles = LOCOMOTION_CYCLES;
  try {
    if (typeof window.__studioCommandRegister === 'function') {
      window.__studioCommandRegister('__studioHumanoidAnimate', window.__studioHumanoidAnimate, 'rig',
        'Pose the humanoid at a normalized locomotion phase t∈[0,1) (walk/run/jump/idle): procedural gait with contralateral swing, hip sway, knee/ankle roll, foot-plant IK; jump = crouch→launch→ballistic flight→absorb→recover.');
      window.__studioCommandRegister('__studioHumanoidPlay', window.__studioHumanoidPlay, 'rig',
        'Play a locomotion cycle over frames×loops, advancing the root forward by stride per cycle (walk/run/jump travel; idle in place). Returns per-frame contact/flight/foot-Y report; jump traces a real ballistic COM arc with a both-feet-off flight window.');
      window.__studioCommandRegister('__studioHumanoidWalkPath', window.__studioHumanoidWalkPath, 'rig',
        'Walk the PROCEDURAL humanoid along a CatmullRom path through the forest clearing: follows the curve, faces the heading (tangent yaw), foot-plants on the sampled terrain, and drives the procedural walk cycle (heel-toe, weight-shift, opposed arm-swing) STRIDE-LOCKED to travel distance (no foot-slide). Returns a per-step contact/foot-Y/heading report.');
      window.__studioCommandRegister('__studioHumanoidLocomotionReset', window.__studioHumanoidLocomotionReset, 'rig',
        'Reset the humanoid root back to its base position after a locomotion play.');
    }
  } catch (_) { /* palette optional */ }
  return { ok: true, cycles: LOCOMOTION_CYCLES };
}

export default installHumanoidLocomotion;
