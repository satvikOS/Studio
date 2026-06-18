// ArchDisc Studio V3 — Rigged Humanoid builder.
//
// buildHumanoid(opts) creates a GENUINE rigged biped in the LIVE viewport scene:
//
//   1. A HUMANOID MESH with real 8-head-canon proportions — a smooth body
//      (capsules for limbs/neck, tapered capsules for the torso, a sphere head,
//      foot wedges), NOT a stack of boxes. Limbs/torso/head/hands/feet are
//      merged (mergeGeometries + mergeVertices for connected 1-ring adjacency)
//      into three skinnable shells: SKIN (head/neck/hands), SHIRT (torso+arms),
//      and TROUSERS (pelvis+legs+feet) so the figure reads clothed, not grey.
//
//   2. A real THREE.Skeleton with a bipedal THREE.Bone hierarchy:
//        pelvis → spine → chest → neck → head
//        chest → clavicle.L/R → shoulder → elbow → wrist → hand   (×2)
//        pelvis → hip.L/R → knee → ankle → foot                   (×2)
//      Each shell is a THREE.SkinnedMesh bound with heat/segment-distance
//      auto-weights from rig/skin.js (`_computeAutoWeights` — the SAME LBS
//      pass the rest of the rig system uses: quadratic segment falloff, top-4
//      influences, normalised Σw=1, 2-pass Laplacian smoothing). skinIndex /
//      skinWeight counts therefore match the position count exactly.
//
//   3. BODY-MECHANICS poses driven purely by rotating bones (LBS deforms the
//      vertices — no per-pose geometry): t-pose, relaxed-stand, walk-stride,
//      sit, reach. CLAMPED to anatomically plausible joint limits so a pose
//      can't hyper-extend a knee or invert an elbow. Exposed as
//      window.__studioPoseHumanoid(poseName) and via opts.pose at build time.
//
//   4. Materials from the shared registry so it renders compatible with
//      __studioLookdevMaterials + the path tracer: SKIN = a warm low-metal
//      medium-rough tone (subsurface-ish within the flat PBR system), SHIRT +
//      TROUSERS = fabric presets. Each mesh is tagged
//      userData.archdiscStudioPrimitive (counts + path-tracer harvest) +
//      userData.studioMaterial (registry id, so the PT/lookdev shade it).
//
// Registers window.__studioBuildHumanoid(opts) + window.__studioPoseHumanoid(pose).
// Pure THREE, no network, no new deps (three + BufferGeometryUtils only — both
// already imported elsewhere in v3, so the CI deps guard stays satisfied).

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MATERIALS, resolveMaterial } from '../materialRegistry.js';
import { _computeAutoWeights, _attachSkinAttrs } from '../rig/skin.js';

const ARM_TAG = 'archdiscStudioRigArmature';
const BONE_TAG = 'archdiscStudioRigBone';

// ── scene / THREE access (live viewport, same convention as lookdev/rig) ──────
function getScene() {
  return (typeof window !== 'undefined' && (window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene))) || null;
}

// ── a warm skin tone living in the flat PBR system (no SSS — see HONEST note).
// Registered into MATERIALS so the path tracer / lookdev can shade it by id.
const SKIN_MATERIAL_ID = 'skin-warm';
if (MATERIALS && !MATERIALS[SKIN_MATERIAL_ID]) {
  MATERIALS[SKIN_MATERIAL_ID] = { color: 0xd8a07a, metalness: 0.0, roughness: 0.55, clearcoat: 0.04 };
}

function matFor(id, color) {
  const m = (MATERIALS && MATERIALS[id]) || resolveMaterial(id);
  const mm = new THREE.MeshStandardMaterial({
    color: typeof color === 'number' ? color : m.color,
    metalness: m.metalness ?? 0.0,
    roughness: m.roughness ?? 0.6,
  });
  return mm;
}

// ─────────────────────────── geometry helpers ───────────────────────────────
// A capsule along +Y, base of the cylindrical section at y=0, growing +Y.
// CapsuleGeometry is centred; we translate so the segment spans [0, len].
function capsule(radius, len, rt = radius) {
  // CapsuleGeometry(radius, length, capSeg, radialSeg) — length is the
  // cylindrical part (caps add `radius` at each end). We want overall feel of
  // a limb of `len`, so make the cylinder len and keep round caps.
  const g = new THREE.CapsuleGeometry(Math.max(0.01, radius), Math.max(0.01, len), 6, 14);
  // taper toward the far (+Y) end if rt != radius (wrist thinner than elbow).
  if (rt !== radius) {
    const pos = g.attributes.position;
    const half = len / 2 + radius;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = (y + half) / (2 * half); // 0 at base, 1 at tip
      const s = THREE.MathUtils.lerp(1, rt / radius, THREE.MathUtils.clamp(t, 0, 1));
      pos.setX(i, pos.getX(i) * s);
      pos.setZ(i, pos.getZ(i) * s);
    }
    pos.needsUpdate = true;
  }
  g.translate(0, len / 2 + radius, 0); // base cap bottom near y=0
  return g;
}

function sphere(r, sy = 1) {
  const g = new THREE.SphereGeometry(r, 18, 14);
  if (sy !== 1) g.scale(1, sy, 1);
  return g;
}

// A torso shell: an elliptical-cross-section tapered solid from pelvis→shoulders.
// Built as a lathe-ish stack via CapsuleGeometry scaled on X/Z for the
// chest/waist shaping so it's a smooth body, not a box.
function torsoGeom(opts) {
  const { waistY, chestY, chestW, chestD, waistW, waistD } = opts;
  const h = chestY - waistY;
  const g = new THREE.CapsuleGeometry(0.5, Math.max(0.02, h), 8, 18);
  g.translate(0, h / 2 + 0.5, 0);
  const pos = g.attributes.position;
  const top = h + 1.0; // capsule full height in its own space
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp(y / top, 0, 1); // 0 base(pelvis) → 1 top(shoulders)
    // taper: narrow at waist (~0.35), widen to chest, ellipse (D < W)
    const wprofile = THREE.MathUtils.lerp(waistW, chestW, smooth(t));
    const dprofile = THREE.MathUtils.lerp(waistD, chestD, smooth(t));
    pos.setX(i, (pos.getX(i) / 0.5) * wprofile);
    pos.setZ(i, (pos.getZ(i) / 0.5) * dprofile);
  }
  pos.needsUpdate = true;
  // place so base sits at waistY
  g.translate(0, waistY - 0.5, 0);
  g.computeVertexNormals();
  return g;
}
function smooth(t) { return t * t * (3 - 2 * t); }

// A simple foot: a stretched, forward-pointing capsule wedge.
function footGeom(len, w, h) {
  const g = new THREE.CapsuleGeometry(w / 2, Math.max(0.01, len - w), 5, 12);
  g.rotateZ(Math.PI / 2); // lie along X first
  g.rotateY(Math.PI / 2); // then along Z (forward)
  g.scale(1, h / (w), 1);
  return g;
}

// ───────────────────────── proportions (8-head canon) ───────────────────────
// Total height `H`. Head height = H/8. All landmarks in metres from floor.
function proportions(H) {
  const head = H / 8;
  return {
    H, head,
    floorY: 0,
    ankleY: 0.04 * H,
    kneeY: 0.26 * H,
    hipY: 0.50 * H,            // pelvis (crotch a touch lower; hip joint here)
    waistY: 0.58 * H,
    chestY: 0.72 * H,          // shoulder line
    shoulderY: 0.81 * H,
    neckY: 0.82 * H,
    headBaseY: 0.875 * H,      // bottom of head (chin region)
    headCY: 0.9375 * H,        // head centre (top head = H)
    // widths / radii
    shoulderHalf: 0.115 * H,   // half shoulder span
    hipHalf: 0.065 * H,
    chestW: 0.105 * H, chestD: 0.072 * H,
    waistW: 0.082 * H, waistD: 0.060 * H,
    upperArmR: 0.030 * H, lowerArmR: 0.024 * H,
    thighR: 0.052 * H, calfR: 0.036 * H,
    neckR: 0.034 * H, headR: 0.066 * H,
    handLen: 0.075 * H, handW: 0.045 * H,
    footLen: 0.135 * H, footW: 0.05 * H, footH: 0.045 * H,
  };
}

// ───────────────────────── skeleton construction ────────────────────────────
// Builds a bipedal Bone hierarchy in WORLD-aligned local offsets. Returns the
// root bone (pelvis) plus a name→bone map. Bone .position is the offset from
// its parent (Three bones chain by local transform). We position bones at joint
// CENTRES so segment-distance weighting maps cleanly to limbs.
function buildSkeleton(P) {
  const bones = {};
  const mk = (name) => { const b = new THREE.Bone(); b.name = name; b.userData[BONE_TAG] = true; bones[name] = b; return b; };
  const setLen = (b, len) => { b.userData.archdiscStudioRigBoneLength = len; };

  // Pelvis (root) at hipY, centred.
  const pelvis = mk('Pelvis');
  pelvis.position.set(0, P.hipY, 0);

  // Spine → chest → neck → head (chain up the +Y axis).
  const spine = mk('Spine'); spine.position.set(0, P.waistY - P.hipY, 0); pelvis.add(spine); setLen(spine, P.waistY - P.hipY);
  const chest = mk('Chest'); chest.position.set(0, P.chestY - P.waistY, 0); spine.add(chest); setLen(chest, P.chestY - P.waistY);
  const neck = mk('Neck'); neck.position.set(0, P.neckY - P.chestY, 0); chest.add(neck); setLen(neck, P.headBaseY - P.neckY);
  const head = mk('Head'); head.position.set(0, P.headBaseY - P.neckY, 0); neck.add(head); setLen(head, P.headR * 2);

  // Arms (×2). clavicle out from chest, then shoulder/elbow/wrist/hand down +X.
  for (const side of [['L', 1], ['R', -1]]) {
    const [s, dir] = side;
    const clav = mk(`Clavicle.${s}`); clav.position.set(dir * 0.04 * P.H, P.shoulderY - P.chestY, 0); chest.add(clav); setLen(clav, P.shoulderHalf * 0.5);
    const shoulder = mk(`Shoulder.${s}`); shoulder.position.set(dir * (P.shoulderHalf - 0.04 * P.H), 0, 0); clav.add(shoulder); setLen(shoulder, 0.16 * P.H);
    const elbow = mk(`Elbow.${s}`); elbow.position.set(dir * 0.16 * P.H, 0, 0); shoulder.add(elbow); setLen(elbow, 0.155 * P.H);
    const wrist = mk(`Wrist.${s}`); wrist.position.set(dir * 0.155 * P.H, 0, 0); elbow.add(wrist); setLen(wrist, P.handLen);
    const hand = mk(`Hand.${s}`); hand.position.set(dir * P.handLen, 0, 0); wrist.add(hand); setLen(hand, P.handLen);
  }

  // Legs (×2). hip out from pelvis, then knee/ankle/foot down -Y.
  for (const side of [['L', 1], ['R', -1]]) {
    const [s, dir] = side;
    const hip = mk(`Hip.${s}`); hip.position.set(dir * P.hipHalf, 0, 0); pelvis.add(hip); setLen(hip, P.hipY - P.kneeY);
    const knee = mk(`Knee.${s}`); knee.position.set(0, -(P.hipY - P.kneeY), 0); hip.add(knee); setLen(knee, P.kneeY - P.ankleY);
    const ankle = mk(`Ankle.${s}`); ankle.position.set(0, -(P.kneeY - P.ankleY), 0); knee.add(ankle); setLen(ankle, P.footLen);
    const foot = mk(`Foot.${s}`); foot.position.set(0, -P.ankleY, P.footLen * 0.4); ankle.add(foot); setLen(foot, P.footLen);
  }

  return { root: pelvis, bones };
}

// Deterministic bone ORDER (traversal) — must match how skin.js collects bones
// (depth-first via Object3D.traverse) so skinIndex lines up with Skeleton.bones.
function orderedBones(root) {
  const out = [];
  root.traverse((o) => { if (o.isBone) out.push(o); });
  return out;
}

// ───────────────────────── mesh shells (body parts) ─────────────────────────
// Builds 3 merged geometries (skin / shirt / trousers) in WORLD space (so the
// bones — which are in world-space offsets after armature placement — segment-
// weight them directly). Returns { skin, shirt, trousers } BufferGeometries.
function buildBodyGeoms(P) {
  const skinParts = [];
  const shirtParts = [];
  const trouserParts = [];

  // HEAD (skin) — slightly egg-shaped sphere.
  {
    const g = sphere(P.headR, 1.18);
    g.translate(0, P.headCY, 0.005);
    skinParts.push(g);
  }
  // NECK (skin).
  {
    const len = P.headBaseY - P.neckY + 0.02;
    const g = capsule(P.neckR, Math.max(0.02, len * 0.6));
    g.translate(0, P.neckY, 0);
    skinParts.push(g);
  }

  // TORSO (shirt) — shaped solid pelvis→shoulders.
  {
    const g = torsoGeom(P);
    shirtParts.push(g);
  }
  // SHOULDER caps (shirt) — round the deltoids.
  for (const dir of [1, -1]) {
    const g = sphere(P.upperArmR * 1.25, 1);
    g.translate(dir * P.shoulderHalf, P.shoulderY, 0);
    shirtParts.push(g);
  }

  // ARMS (shirt sleeve = upper+lower arm; hands are skin).
  for (const dir of [1, -1]) {
    // upper arm: shoulder→elbow, pointing outward (+X) and slightly down.
    const shoulderX = dir * P.shoulderHalf, shoulderY = P.shoulderY;
    const elbowX = dir * (P.shoulderHalf + 0.16 * P.H), elbowY = P.shoulderY;
    shirtParts.push(segCapsule(shoulderX, shoulderY, 0, elbowX, elbowY, 0, P.upperArmR, P.lowerArmR * 1.1));
    const wristX = dir * (P.shoulderHalf + 0.16 * P.H + 0.155 * P.H), wristY = P.shoulderY;
    shirtParts.push(segCapsule(elbowX, elbowY, 0, wristX, wristY, 0, P.lowerArmR * 1.1, P.lowerArmR));
    // hand (skin) — a small flattened capsule continuing +X.
    const handG = capsule(P.handW * 0.55, P.handLen * 0.7);
    handG.rotateZ(dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    handG.scale(1, 1, 0.55); // flatten front-back
    handG.translate(wristX + dir * P.handLen * 0.45, wristY, 0);
    skinParts.push(handG);
  }

  // PELVIS block (trousers) — bridge waist→hips, slightly wider hips.
  {
    const g = capsule(P.waistW * 0.92, Math.max(0.02, (P.waistY - P.hipY) + 0.04));
    g.scale(1, 1, P.waistD / P.waistW);
    g.translate(0, P.hipY - 0.02, 0);
    trouserParts.push(g);
  }

  // LEGS (trousers = thigh+calf; feet separate).
  for (const dir of [1, -1]) {
    const hipX = dir * P.hipHalf, hipY = P.hipY;
    const kneeX = dir * P.hipHalf * 0.85, kneeY = P.kneeY;
    trouserParts.push(segCapsule(hipX, hipY, 0, kneeX, kneeY, 0, P.thighR, P.calfR * 1.15));
    const ankleX = dir * P.hipHalf * 0.8, ankleY = P.ankleY;
    trouserParts.push(segCapsule(kneeX, kneeY, 0, ankleX, ankleY, 0, P.calfR * 1.15, P.calfR * 0.7));
    // foot (skin/shoe — keep on trousers shell as "shoe" colour later; use skin tone shoe? use trousers fabric for shoe).
    const fg = footGeom(P.footLen, P.footW, P.footH);
    fg.translate(ankleX, P.footH / 2, P.footLen * 0.25);
    trouserParts.push(fg);
  }

  const merge = (parts) => {
    const m = mergeGeometries(parts.map((g) => g.toNonIndexed()), false);
    // Weld coincident verts → real 1-ring adjacency for Laplacian weight smoothing.
    const welded = mergeVertices(m, 1e-4);
    welded.computeVertexNormals();
    return welded;
  };

  return { skin: merge(skinParts), shirt: merge(shirtParts), trousers: merge(trouserParts) };
}

// A capsule spanning two world points a→b, with a base/tip radius taper.
function segCapsule(ax, ay, az, bx, by, bz, rBase, rTip) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  const g = capsule(rBase, Math.max(0.01, len - rBase), rTip);
  // capsule grows +Y from origin; rotate +Y axis to (a→b) direction, translate to a.
  const from = new THREE.Vector3(0, 1, 0);
  const to = new THREE.Vector3(dx, dy, dz).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(from, to);
  g.applyQuaternion(q);
  g.translate(ax, ay, az);
  return g;
}

// ───────────────────────── pose library (body mechanics) ────────────────────
// Each pose is a map boneName → [ex,ey,ez] LOCAL Euler (radians). Values are
// CLAMPED to per-joint limits before applying so nothing hyper-extends.
// Side-aware mirroring handled inline (L/R) where it matters.
const JOINT_LIMITS = {
  // [min,max] per axis (radians). Generous but anatomically bounded.
  Spine: [[-0.6, 0.9], [-0.7, 0.7], [-0.5, 0.5]],
  Chest: [[-0.5, 0.7], [-0.6, 0.6], [-0.4, 0.4]],
  Neck: [[-0.7, 0.7], [-0.9, 0.9], [-0.5, 0.5]],
  Head: [[-0.7, 0.6], [-0.9, 0.9], [-0.5, 0.5]],
  Shoulder: [[-1.6, 1.8], [-1.8, 1.8], [-2.2, 2.2]],
  Elbow: [[-0.1, 2.6], [-0.2, 0.2], [-2.6, 0.1]], // hinge: no hyper-extend past ~0
  Wrist: [[-0.8, 0.8], [-0.6, 0.6], [-0.6, 0.6]],
  Hip: [[-1.7, 1.0], [-0.6, 0.6], [-1.4, 1.4]],
  Knee: [[-2.5, 0.05], [-0.1, 0.1], [-0.1, 0.1]], // hinge: flexes negative-X, no hyper-extend
  Ankle: [[-0.7, 0.9], [-0.3, 0.3], [-0.3, 0.3]],
  Clavicle: [[-0.3, 0.3], [-0.3, 0.3], [-0.5, 0.5]],
};
function baseName(n) { return n.replace(/\.[LR]$/, ''); }
function clampEuler(name, e) {
  const lim = JOINT_LIMITS[baseName(name)];
  if (!lim) return e;
  return [
    THREE.MathUtils.clamp(e[0], lim[0][0], lim[0][1]),
    THREE.MathUtils.clamp(e[1], lim[1][0], lim[1][1]),
    THREE.MathUtils.clamp(e[2], lim[2][0], lim[2][1]),
  ];
}

// Pose generators. Note arms rest along -Z-ish? Our bind pose is a T-pose
// (arms straight out +X/-X). So "relaxed" rotates shoulders DOWN to the sides.
// Shoulder local axes: rotating Z brings the +X arm down toward -Y.
function POSES() {
  return {
    't-pose': () => ({}), // bind pose — arms out, legs straight.

    'relaxed-stand': () => ({
      'Shoulder.L': [0.05, 0, -1.35], 'Shoulder.R': [0.05, 0, 1.35],
      'Elbow.L': [0, 0, -0.25], 'Elbow.R': [0, 0, 0.25],
      'Spine': [0.04, 0, 0], 'Chest': [0.02, 0, 0],
      'Hip.L': [0.04, 0, 0.02], 'Hip.R': [0.04, 0, -0.02],
      'Knee.L': [-0.06, 0, 0], 'Knee.R': [-0.06, 0, 0],
      'Neck': [0.05, 0, 0],
    }),

    'walk-stride': () => ({
      // arms down + counter-swing, legs in a mid-stride (L forward, R back).
      'Shoulder.L': [-0.5, 0, -1.3], 'Shoulder.R': [0.5, 0, 1.3],
      'Elbow.L': [0, 0, -0.7], 'Elbow.R': [0, 0, 0.7],
      'Spine': [0.06, 0.08, 0], 'Chest': [0.03, -0.05, 0],
      'Hip.L': [0.55, 0, 0], 'Knee.L': [-0.25, 0, 0], 'Ankle.L': [0.15, 0, 0],
      'Hip.R': [-0.45, 0, 0], 'Knee.R': [-0.6, 0, 0], 'Ankle.R': [-0.2, 0, 0],
      'Neck': [0.04, 0, 0],
    }),

    'sit': () => ({
      // thighs forward ~90°, knees bent ~90°, arms relaxed forward-rest.
      'Hip.L': [1.5, 0, 0.05], 'Hip.R': [1.5, 0, -0.05],
      'Knee.L': [-1.5, 0, 0], 'Knee.R': [-1.5, 0, 0],
      'Ankle.L': [0.2, 0, 0], 'Ankle.R': [0.2, 0, 0],
      'Shoulder.L': [0.35, 0, -1.25], 'Shoulder.R': [0.35, 0, 1.25],
      'Elbow.L': [0, 0, -0.9], 'Elbow.R': [0, 0, 0.9],
      'Spine': [0.12, 0, 0], 'Chest': [0.05, 0, 0],
    }),

    'reach': () => ({
      // right arm reaches up-and-forward, body braces, left arm low.
      'Shoulder.R': [-1.0, 0, 0.6], 'Elbow.R': [0, 0, -0.35], 'Wrist.R': [0.2, 0, 0],
      'Shoulder.L': [0.1, 0, -1.2], 'Elbow.L': [0, 0, -0.4],
      'Spine': [-0.1, -0.18, 0], 'Chest': [-0.08, -0.12, 0], 'Neck': [-0.15, -0.1, 0],
      'Hip.L': [0.15, 0, 0.03], 'Hip.R': [-0.1, 0, -0.03],
      'Knee.L': [-0.2, 0, 0], 'Knee.R': [-0.1, 0, 0],
    }),
  };
}
export const HUMANOID_POSES = ['t-pose', 'relaxed-stand', 'walk-stride', 'sit', 'reach'];

// Apply a named pose to an armature's bones (reset to bind, then set+clamp).
function applyPose(armRoot, boneMap, poseName) {
  const poses = POSES();
  const gen = poses[poseName] || poses['t-pose'];
  const set = gen();
  // Reset every bone to bind (zero rotation) first so poses don't accumulate.
  for (const k of Object.keys(boneMap)) boneMap[k].rotation.set(0, 0, 0);
  const applied = [];
  for (const name of Object.keys(set)) {
    const b = boneMap[name];
    if (!b) continue;
    const e = clampEuler(name, set[name]);
    b.rotation.set(e[0], e[1], e[2]);
    applied.push(name);
  }
  // refresh world matrices + skeleton(s).
  const arm = armRoot;
  if (arm) {
    arm.updateMatrixWorld(true);
    const skel = arm.userData && arm.userData.archdiscStudioRigSkeleton;
    if (skel && typeof skel.update === 'function') skel.update();
    // also update any skinned-mesh skeletons under it
    arm.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.update(); });
  }
  return applied;
}

// ───────────────────────────── build ────────────────────────────────────────
export function buildHumanoid(opts = {}) {
  const scene = getScene();
  const THREEref = (typeof window !== 'undefined' && window.__archdiscTHREE) || THREE;
  if (!scene) return { ok: false, error: 'no scene' };

  const H = Number(opts.height) > 0 ? Number(opts.height) : 1.8; // metres
  const P = proportions(H);
  const origin = Array.isArray(opts.position) && opts.position.length === 3 ? opts.position : [0, 0, 0];

  // 1) Armature Group (carries the rig the way the rig/ system expects).
  const armature = new THREEref.Group();
  armature.name = opts.name || `Humanoid-${Math.floor(Math.random() * 1e6)}`;
  armature.userData[ARM_TAG] = true;
  armature.userData.archdiscStudioRigArmatureName = armature.name;
  armature.position.set(origin[0], origin[1], origin[2]);

  // 2) Skeleton bones (built in body-local space; armature carries world pos).
  const { root } = buildSkeleton(P);
  armature.add(root);
  const boneList = orderedBones(root);
  scene.add(armature);
  // Propagate world transforms BEFORE constructing the Skeleton — the Skeleton
  // ctor snapshots each bone's world matrix into boneInverses (the bind pose).
  // If we build it while bones are still at the origin, every inverse is
  // identity and the SkinnedMesh deforms wildly (arm-tips fly metres). With
  // matrices current, boneInverses capture the true bind pose.
  armature.updateMatrixWorld(true);
  const skeleton = new THREEref.Skeleton(boneList);
  armature.userData.archdiscStudioRigSkeleton = skeleton;
  armature.userData.archdiscStudioRigRoot = root;
  const boneMap = new Map();
  for (const b of boneList) boneMap.set(b.uuid, b);
  armature.userData.archdiscStudioRigBones = boneMap;

  // 3) Body shells (skin / shirt / trousers) → SkinnedMeshes bound to skeleton.
  const geoms = buildBodyGeoms(P);
  const shells = [
    { key: 'skin', geom: geoms.skin, matId: SKIN_MATERIAL_ID, name: 'Skin' },
    { key: 'shirt', geom: geoms.shirt, matId: opts.shirtMaterial || 'fabric-linen', name: 'Shirt' },
    { key: 'trousers', geom: geoms.trousers, matId: opts.trouserMaterial || 'fabric-grey', name: 'Trousers' },
  ];

  const skinnedMeshes = [];
  let totalVerts = 0;
  const weightReport = [];
  for (const sh of shells) {
    const geom = sh.geom;
    const mat = matFor(sh.matId);
    mat.skinning = true;
    const mesh = new THREEref.SkinnedMesh(geom, mat);
    mesh.name = `${armature.name}-${sh.name}`;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'skinnedmesh';
    mesh.userData.studioMaterial = sh.matId;
    mesh.userData.archdiscStudioRigArmatureUuid = armature.uuid;
    mesh.userData.archdiscStudioHumanoidShell = sh.key;
    // Mesh lives at the armature's world transform so its bind matrix matches.
    mesh.position.set(origin[0], origin[1], origin[2]);
    scene.add(mesh);
    mesh.updateMatrixWorld(true);

    // Heat/segment-distance auto-weights against the SAME bones, in world.
    // radius scaled to body so falloff reaches across a limb's thickness.
    const r = _computeAutoWeights(mesh, boneList, { radius: 0.18 * H, smoothPasses: 2 });
    _attachSkinAttrs(geom, r.indices, r.weights);
    mesh.bind(skeleton, mesh.matrixWorld);

    skinnedMeshes.push(mesh);
    totalVerts += r.vertexCount;
    weightReport.push({ shell: sh.key, verts: r.vertexCount, material: sh.matId });
  }

  // 4) Default pose (opts.pose or relaxed-stand so it doesn't render as a stiff T).
  const initialPose = opts.pose && HUMANOID_POSES.includes(opts.pose) ? opts.pose : 'relaxed-stand';
  applyPose(armature, mapByName(boneList), initialPose);

  // Stash the per-humanoid handle so window.__studioPoseHumanoid can find it
  // (supports multiple humanoids — keyed by armature uuid, plus a "last" ptr).
  if (typeof window !== 'undefined') {
    window.__studioHumanoids = window.__studioHumanoids || {};
    window.__studioHumanoids[armature.uuid] = { armature, boneList, skeleton, skinnedMeshes };
    window.__studioHumanoidLast = armature.uuid;
  }

  return {
    ok: true,
    armatureUuid: armature.uuid,
    name: armature.name,
    height: H,
    boneCount: boneList.length,
    boneNames: boneList.map((b) => b.name),
    shells: weightReport,
    skinnedMeshUuids: skinnedMeshes.map((m) => m.uuid),
    totalVertices: totalVerts,
    pose: initialPose,
    poses: HUMANOID_POSES,
    materials: { skin: SKIN_MATERIAL_ID, shirt: shells[1].matId, trousers: shells[2].matId },
  };
}

function mapByName(boneList) {
  const m = {};
  for (const b of boneList) m[b.name] = b;
  return m;
}

// Pose the most-recent (or a specific) humanoid by name.
export function poseHumanoid(poseName, armatureUuid) {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  const store = window.__studioHumanoids || {};
  const uuid = armatureUuid || window.__studioHumanoidLast;
  const h = uuid && store[uuid];
  if (!h) return { ok: false, error: 'no humanoid built yet' };
  if (!HUMANOID_POSES.includes(poseName)) {
    return { ok: false, error: `unknown pose '${poseName}'`, poses: HUMANOID_POSES };
  }
  const applied = applyPose(h.armature, mapByName(h.boneList), poseName);
  return { ok: true, armatureUuid: uuid, pose: poseName, bonesPosed: applied.length, posed: applied };
}

// ───────────────────────────── install ──────────────────────────────────────
export function installHumanoidBuilder() {
  if (typeof window === 'undefined') return;
  window.__studioBuildHumanoid = (o) => buildHumanoid(o || {});
  window.__studioPoseHumanoid = (pose, armUuid) => poseHumanoid(pose, armUuid);
  window.__studioHumanoidPoses = HUMANOID_POSES;
  // Register with the command palette if available (same surface as the rig ops).
  try {
    if (typeof window.__studioCommandRegister === 'function') {
      window.__studioCommandRegister('__studioBuildHumanoid', window.__studioBuildHumanoid, 'rig',
        'Build a rigged humanoid (8-head proportions, bipedal skeleton, skinned shells).');
      window.__studioCommandRegister('__studioPoseHumanoid', window.__studioPoseHumanoid, 'rig',
        'Pose the humanoid (t-pose / relaxed-stand / walk-stride / sit / reach) via bone rotation.');
    }
  } catch (_) { /* palette optional */ }
}

export default installHumanoidBuilder;
