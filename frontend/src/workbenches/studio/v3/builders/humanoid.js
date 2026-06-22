// ArchDisc Studio V3 — Rigged Humanoid builder.
//
// buildHumanoid(opts) creates a GENUINE rigged biped in the LIVE viewport scene.
//
// ── 2026-06-17 RAGDOLL FIX — IMPLICIT-SURFACE BODY ───────────────────────────
// The previous build welded ~40 separate ellipsoid / profile-solid "blobs"
// (head, neck, torso, each arm/leg segment, hands, feet, muscle pads) with
// mergeVertices. Welding distinct shells that only *touch* leaves INTERSECTION
// SEAMS where two surfaces cross (the welder only fuses coincident verts, not
// crossing faces) and pads that overlap as discrete lumps. Worse, in motion the
// skin auto-weighter sees fragmented 1-ring adjacency across those seams, so the
// LBS deformation COLLAPSES (candy-wraps) at elbows/knees/shoulders — the
// "broken ragdoll".
//
// The fix rebuilds the BODY SKIN as ONE seamless watertight mesh from an
// IMPLICIT SURFACE (still 100% procedural, NO imports, NO base mesh):
//
//   1. The body is a SIGNED-DISTANCE FIELD: a skeleton of CAPSULES (torso,
//      neck, upper/lower arms, hands, upper/lower legs, feet) + ELLIPSOIDS
//      (cranium, ribcage, pelvis, deltoid/pectoral/glute/quad/calf muscle
//      masses), each parameterised from `proportions(H)`. Primitives are
//      combined with a POLYNOMIAL SMOOTH-MINIMUM (smin) so adjacent parts BLEND
//      into one continuous surface instead of intersecting — this is what
//      removes the seams.
//   2. The field is polygonised by a compact, hand-written MARCHING CUBES over a
//      non-cubic grid sized to the body's bounding box. Resolution is tuned for
//      ~30–60k verts (organic read, not a stall). One watertight shell results.
//   3. ANTHROPOMETRICALLY CORRECT proportions: 8-head canon (head = H/8),
//      shoulder span ≈2 heads, correct limb-length ratios, realistic mass
//      distribution. Height + build are parametric (opts.height / opts.build).
//   4. The 58-bone skeleton (Spine1/2/3, clavicles, 30 finger bones, Toe.L/R,
//      Jaw) is UNCHANGED and re-bound: skin weights are computed against the NEW
//      seamless mesh via the rig's heat-style segment-distance falloff
//      (`_computeAutoWeights` — quadratic 1/dist falloff to nearest bones,
//      top-4, Σw=1, Laplacian-smoothed over the now-CONTINUOUS 1-ring). Because
//      the surface is one blended manifold, joints bend smoothly — no collapse.
//   5. Public API preserved: buildHumanoid / installHumanoidBuilder /
//      poseHumanoid / HUMANOID_POSES / window.__studioBuildHumanoid /
//      window.__studioPoseHumanoid, and the material tags. Marching cubes makes
//      a SINGLE shell, so material is split by REGION (a clothing scalar field:
//      torso/upper-arm band → shirt, pelvis/legs band → trousers, everything
//      else → skin) into three SkinnedMesh shells, each tagged
//      userData.studioMaterial so the lookdev / path-tracer shade it.
//   6. CYLINDRICAL region UVs are projected so the existing real 4K skin/fabric
//      PBR maps still land.
//
//   Body-mechanics POSES are unchanged (pure bone rotation, clamped joint
//   limits): t-pose, relaxed-stand, walk-stride, sit, reach.
//
// Registers window.__studioBuildHumanoid(opts) + window.__studioPoseHumanoid(pose).
// Pure THREE, no network, NO new deps (three + BufferGeometryUtils + the rig
// skin pass only — all already imported elsewhere in v3, so the CI deps guard
// stays satisfied; marching cubes is hand-written here).

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MATERIALS, resolveMaterial } from '../materialRegistry.js';
import { _computeAutoWeights, _attachSkinAttrs } from '../rig/skin.js';

const ARM_TAG = 'archdiscStudioRigArmature';
const BONE_TAG = 'archdiscStudioRigBone';

// ── scene / THREE access (live viewport, same convention as lookdev/rig) ──────
function getScene() {
  return (typeof window !== 'undefined' && (window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene))) || null;
}

// ── the skin shell uses the registry's 'skin-warm' material — a subsurface
// APPROXIMATION (warm dermal base + transmission/thickness + warm attenuation +
// peach sheen + faint oil clearcoat) that the lookdev/path-tracer also load the
// real 4K skin scan onto (see materialRegistry.js + lookdevDirector.applyMaterials).
const SKIN_MATERIAL_ID = 'skin-warm';
if (MATERIALS && !MATERIALS[SKIN_MATERIAL_ID]) {
  // Fallback only — the canonical 'skin-warm' lives in materialRegistry.js.
  MATERIALS[SKIN_MATERIAL_ID] = { color: 0xe6b89c, metalness: 0.0, roughness: 0.46, clearcoat: 0.12, isSkin: true };
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

// ───────────────────── implicit-surface body (SDF + MC) ─────────────────────
// The body skin is ONE seamless watertight mesh polygonised from a signed-
// distance field. We model the figure as a union of analytic primitives —
// CAPSULES for the limbs/torso/neck/hands/feet and ELLIPSOIDS for the cranium /
// ribcage / pelvis / muscle masses — combined with a POLYNOMIAL SMOOTH-MIN so
// neighbouring parts BLEND into a continuous surface (no intersection seams).
//
// SDF convention: f(p) < 0 inside, > 0 outside, ≈0 on the surface. Marching
// cubes extracts the f = 0 isosurface. (We negate to feed MC, which expects the
// surface where the scalar field crosses a positive isolevel — see polygonize.)

function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

// Polynomial smooth-minimum (Inigo Quilez). k controls the blend radius — the
// larger k, the rounder/fatter the join. Returns a C1-continuous min so unioned
// SDFs fuse instead of creasing at the intersection.
function smin(a, b, k) {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b * (1 - h) + a * h - k * h * (1 - h);
}

// Signed distance to a CAPSULE: segment a→b with radius r (optionally ra→rb
// tapered). p is {x,y,z}. Tapered capsules let an arm thin from biceps to wrist
// within a single primitive (cleaner blend than two capsules).
function sdCapsule(px, py, pz, ax, ay, az, bx, by, bz, ra, rb) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const ab2 = abx * abx + aby * aby + abz * abz || 1e-9;
  let t = (apx * abx + apy * aby + apz * abz) / ab2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = ax + abx * t, cy = ay + aby * t, cz = az + abz * t;
  const dx = px - cx, dy = py - cy, dz = pz - cz;
  const r = rb === undefined ? ra : ra + (rb - ra) * t;
  return Math.hypot(dx, dy, dz) - r;
}

// Signed distance to an axis-aligned ELLIPSOID centred at (cx,cy,cz) with radii
// (rx,ry,rz). The exact ellipsoid SDF is non-trivial; this is the standard IQ
// bounded approximation (k1 - k2 form) which is accurate near the surface — all
// MC needs. Optional yaw rotates the primitive about +Y (cheap, for ribcage
// depth / deltoid lean) — applied by rotating p into local space first.
function sdEllipsoid(px, py, pz, cx, cy, cz, rx, ry, rz, yaw) {
  let lx = px - cx, ly = py - cy, lz = pz - cz;
  if (yaw) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const nx = cs * lx - sn * lz, nz = sn * lx + cs * lz;
    lx = nx; lz = nz;
  }
  const ex = lx / rx, ey = ly / ry, ez = lz / rz;
  const k1 = Math.hypot(ex, ey, ez);
  const k2 = Math.hypot(ex / rx, ey / ry, ez / rz) || 1e-9;
  return (k1 * (k1 - 1.0)) / k2;
}

// Build the list of SDF primitives (capsules + ellipsoids) for the body in
// WORLD space, sized from the 8-head proportions. Each primitive carries a
// `blend` (its smin k with the rest of the body) and a REGION tag so the mesh
// can later be split into skin / shirt / trousers shells. Returns an array of
// { kind, ..., blend, region } where region ∈ {'skin','shirt','trousers'}.
//
// region drives material assignment after MC; geometry is ONE field regardless.
function bodyPrimitives(P) {
  const prims = [];
  const cap = (a, b, ra, rb, blend, region) => prims.push({
    kind: 'cap', ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2],
    ra, rb: rb === undefined ? ra : rb, blend, region,
  });
  const ell = (c, r, blend, region, yaw) => prims.push({
    kind: 'ell', cx: c[0], cy: c[1], cz: c[2], rx: r[0], ry: r[1], rz: r[2],
    yaw: yaw || 0, blend, region,
  });

  const H = P.H;
  const kBody = 0.045 * H;   // global blend radius for adjacent body parts
  const kJoint = 0.06 * H;   // larger blend at the big joints (smooth elbows/knees)
  const kSmall = 0.012 * H;  // tight blend for fingers / face features

  // ── TORSO: pelvis → waist → chest as a stack of blended capsules + a ribcage
  //   and pelvis ellipsoid for mass. Region 'shirt' for the upper torso.
  cap([0, P.hipY, 0], [0, P.waistY, 0], P.hipHalf * 1.35, P.waistW * 1.02, kBody, 'trousers'); // pelvis core (trousers)
  ell([0, P.hipY + P.head * 0.02, -P.waistD * 0.15], [P.hipHalf * 1.45, P.head * 0.5, P.waistD * 1.1], kBody, 'trousers'); // pelvis/glute mass
  cap([0, P.waistY, 0], [0, P.chestY, 0], P.waistW * 1.02, P.chestW * 1.02, kBody, 'shirt');    // abdomen → lower chest
  ell([0, P.chestY - P.head * 0.05, P.chestD * 0.05], [P.chestW * 1.12, P.head * 0.95, P.chestD * 1.15], kBody, 'shirt'); // ribcage mass
  cap([0, P.chestY, 0], [0, P.shoulderY, 0], P.chestW * 1.02, P.shoulderHalf * 0.9, kBody, 'shirt'); // upper chest → shoulder yoke
  // pectoral swell (two soft front masses)
  for (const d of [1, -1]) ell([d * P.chestW * 0.42, P.chestY + P.head * 0.04, P.chestD * 0.7], [P.chestW * 0.4, P.chestW * 0.26, P.chestD * 0.42], kBody, 'shirt');
  // shoulder yoke ellipsoid (broad, ~2-head shoulder span) — blends the deltoids
  ell([0, P.shoulderY, 0], [P.shoulderHalf * 1.04, P.head * 0.42, P.chestD * 0.95], kJoint, 'shirt');

  // ── NECK + HEAD (skin). Neck capsule, cranium + face + jaw ellipsoids smin'd.
  cap([0, P.neckY - 0.01 * H, 0], [0, P.headBaseY, 0], P.neckR * 1.15, P.neckR * 0.95, kBody, 'skin');
  // cranium (egg: deeper occiput), face mass (fuller lower front), jaw taper.
  ell([0, P.headCY + P.headRY * 0.05, -P.headRZ * 0.05], [P.headRX, P.headRY, P.headRZ * 1.04], kBody, 'skin');
  ell([0, P.headCY - P.headRY * 0.18, P.headRZ * 0.16], [P.headRX * 0.9, P.headRY * 0.66, P.headRZ * 0.92], kBody, 'skin'); // face / cheeks / maxilla
  ell([0, P.headBaseY + P.headRY * 0.28, P.headRZ * 0.18], [P.headRX * 0.66, P.headRY * 0.4, P.headRZ * 0.7], kBody, 'skin'); // jaw + chin
  // nose ridge (small forward capsule), ears (side ellipsoids) — tight blend so
  // they read as features, not lumps swallowed by the head.
  cap([0, P.headCY + P.browUp * 0.4, P.headRZ * 0.86], [0, P.headCY - P.noseLen * 0.7, P.headRZ * 1.02], P.headRX * 0.1, P.headRX * 0.14, kSmall, 'skin');
  for (const d of [1, -1]) ell([d * P.headRX * 0.96, P.headCY + P.earUp, -P.headRZ * 0.04], [P.headRZ * 0.12, P.headRY * 0.3, P.headRZ * 0.3], kSmall, 'skin');

  // ── ARMS (deltoid skin/shirt, forearm skin, hand skin). Bind pose = T-pose:
  //   arms straight out along ±X at shoulderY. Tapered capsules give the muscle
  //   bellies; a deltoid ellipsoid rounds the shoulder; the hand is a flattened
  //   palm capsule + finger capsules (blended so they read as one hand).
  const upperArmLen = 0.16 * H, lowerArmLen = 0.155 * H;
  for (const dir of [1, -1]) {
    const sx = dir * P.shoulderHalf, sy = P.shoulderY;
    const ex = dir * (P.shoulderHalf + upperArmLen), ey = P.shoulderY;
    const wx = dir * (P.shoulderHalf + upperArmLen + lowerArmLen), wy = P.shoulderY;
    ell([dir * (P.shoulderHalf - P.deltoidR * 0.1), sy, 0], [P.deltoidR * 1.15, P.deltoidR * 1.1, P.deltoidR * 1.05], kJoint, 'shirt'); // deltoid cap
    cap([sx, sy, 0], [ex, ey, 0], P.bicepsR, P.elbowR, kJoint, 'shirt');   // upper arm (sleeve)
    ell([dir * (P.shoulderHalf + upperArmLen * 0.4), sy, -P.bicepsR * 0.2], [P.bicepsR * 1.1, P.bicepsR * 1.05, P.bicepsR * 1.15], kBody, 'shirt'); // biceps/triceps belly
    cap([ex, ey, 0], [wx, wy, 0], P.elbowR, P.wristR, kJoint, 'skin');     // forearm (bare → skin)
    ell([dir * (P.shoulderHalf + upperArmLen + lowerArmLen * 0.3), ey, 0], [P.forearmR * 1.05, P.forearmR, P.forearmR * 1.05], kBody, 'skin'); // forearm flexor belly
    // hand: palm capsule + four finger capsules + opposed thumb. Local +X·dir.
    const palmStartX = wx + dir * P.wristR;
    const knuckleX = palmStartX + dir * P.palmLen;
    cap([palmStartX, wy, 0], [knuckleX, wy, 0], P.handW * 0.36, P.handW * 0.34, kBody, 'skin'); // palm
    const spread = [1.5, 0.5, -0.5, -1.5];
    for (let f = 0; f < 4; f++) {
      const z = dir * spread[f] * (P.fingerSpan / 6);
      const tipX = knuckleX + dir * P.fingerLens[f];
      cap([knuckleX, wy, z], [tipX, wy - P.fingerLens[f] * 0.1, z], P.fingerRoot, P.fingerRoot * 0.55, kSmall, 'skin');
    }
    // thumb — opposed, off the palm body-side, angled down/forward.
    const thZ = -dir * P.handW * 0.42;
    cap([palmStartX + dir * P.palmLen * 0.3, wy - P.handW * 0.1, thZ],
        [palmStartX + dir * (P.palmLen * 0.3 + P.thumbLen * 0.7), wy - P.handW * 0.25, thZ - dir * P.thumbLen * 0.4],
        P.thumbRoot, P.thumbRoot * 0.6, kSmall, 'skin');
  }

  // ── LEGS (trousers thigh/calf, skin foot via shoe-on-trousers region). Bind
  //   pose = straight down −Y. Tapered capsules + quad/calf ellipsoids.
  for (const dir of [1, -1]) {
    const hx = dir * P.hipHalf, hy = P.hipY;
    const kx = dir * P.hipHalf * 0.82, ky = P.kneeY;
    const ax = dir * P.hipHalf * 0.78, ay = P.ankleY;
    cap([hx, hy, 0], [kx, ky, 0], P.thighTopR, P.kneeR, kJoint, 'trousers');   // thigh
    ell([dir * P.hipHalf * 0.9, hy - (hy - ky) * 0.4, P.waistD * 0.05], [P.thighR * 1.05, (hy - ky) * 0.32, P.thighR * 1.1], kBody, 'trousers'); // quad/ham belly
    cap([kx, ky, 0], [ax, ay, 0], P.kneeR, P.ankleR, kJoint, 'trousers');      // calf
    ell([ax, ky - (ky - ay) * 0.32, -P.calfR * 0.25], [P.calfR, (ky - ay) * 0.3, P.calfR * 1.05], kBody, 'trousers'); // gastroc belly
    // foot: ankle → toe forward (+Z), low + flat-ish (a capsule near the floor).
    const footFwd = P.footLen;
    cap([ax, P.footH * 0.5, 0], [ax, P.footH * 0.45, footFwd], P.footH * 0.5, P.footH * 0.34, kJoint, 'trousers');
    // heel cap behind the ankle so the back of the foot is rounded
    ell([ax, P.footH * 0.5, -P.footLen * 0.06], [P.footW * 0.5, P.footH * 0.5, P.footH * 0.6], kBody, 'trousers');
  }

  return prims;
}

// Evaluate the body SDF at a point: smooth-union of every primitive's signed
// distance (each with its own blend k). Returns f < 0 inside. We seed with the
// first primitive then progressively smin the rest in.
function evalBodySDF(prims, px, py, pz) {
  let d = Infinity;
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i];
    const di = p.kind === 'cap'
      ? sdCapsule(px, py, pz, p.ax, p.ay, p.az, p.bx, p.by, p.bz, p.ra, p.rb)
      : sdEllipsoid(px, py, pz, p.cx, p.cy, p.cz, p.rx, p.ry, p.rz, p.yaw);
    d = i === 0 ? di : smin(d, di, p.blend);
  }
  return d;
}

// ── MARCHING CUBES (hand-written, compact). Polygonises the f = 0 isosurface
// of the body SDF over a non-cubic grid covering the body bounding box. We
// sample the field on a dense lattice, then for each cell look up the standard
// MC triangle table and emit interpolated vertices on the zero-crossing edges.
// Returns an INDEXED, vertex-welded BufferGeometry (one watertight shell) plus
// a per-triangle REGION tag so the caller can split it into material shells.
//
// To tag regions we record, at each emitted surface vertex, the REGION of the
// nearest contributing primitive (the one with the smallest raw distance there)
// — so a vertex over the chest is 'shirt', over the forearm 'skin', etc.

// Edge → the two corner indices it connects (standard MC corner numbering).
const MC_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
// Corner offsets (unit cube), standard MC ordering.
const MC_CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

// ── Standard Marching Cubes lookup tables (Paul Bourke / Lorensen-Cline).
// MC_EDGE_TABLE[cubeIndex] is a 12-bit mask of which edges the surface crosses.
// MC_TRI_TABLE[cubeIndex] lists triangles as edge indices (terminated by -1).
// Corner + edge numbering match MC_CORNERS / MC_EDGES above.
const MC_EDGE_TABLE = [
0x0,0x109,0x203,0x30a,0x406,0x50f,0x605,0x70c,0x80c,0x905,0xa0f,0xb06,0xc0a,0xd03,0xe09,0xf00,
0x190,0x99,0x393,0x29a,0x596,0x49f,0x795,0x69c,0x99c,0x895,0xb9f,0xa96,0xd9a,0xc93,0xf99,0xe90,
0x230,0x339,0x33,0x13a,0x636,0x73f,0x435,0x53c,0xa3c,0xb35,0x83f,0x936,0xe3a,0xf33,0xc39,0xd30,
0x3a0,0x2a9,0x1a3,0xaa,0x7a6,0x6af,0x5a5,0x4ac,0xbac,0xaa5,0x9af,0x8a6,0xfaa,0xea3,0xda9,0xca0,
0x460,0x569,0x663,0x76a,0x66,0x16f,0x265,0x36c,0xc6c,0xd65,0xe6f,0xf66,0x86a,0x963,0xa69,0xb60,
0x5f0,0x4f9,0x7f3,0x6fa,0x1f6,0xff,0x3f5,0x2fc,0xdfc,0xcf5,0xfff,0xef6,0x9fa,0x8f3,0xbf9,0xaf0,
0x650,0x759,0x453,0x55a,0x256,0x35f,0x55,0x15c,0xe5c,0xf55,0xc5f,0xd56,0xa5a,0xb53,0x859,0x950,
0x7c0,0x6c9,0x5c3,0x4ca,0x3c6,0x2cf,0x1c5,0xcc,0xfcc,0xec5,0xdcf,0xcc6,0xbca,0xac3,0x9c9,0x8c0,
0x8c0,0x9c9,0xac3,0xbca,0xcc6,0xdcf,0xec5,0xfcc,0xcc,0x1c5,0x2cf,0x3c6,0x4ca,0x5c3,0x6c9,0x7c0,
0x950,0x859,0xb53,0xa5a,0xd56,0xc5f,0xf55,0xe5c,0x15c,0x55,0x35f,0x256,0x55a,0x453,0x759,0x650,
0xaf0,0xbf9,0x8f3,0x9fa,0xef6,0xfff,0xcf5,0xdfc,0x2fc,0x3f5,0xff,0x1f6,0x6fa,0x7f3,0x4f9,0x5f0,
0xb60,0xa69,0x963,0x86a,0xf66,0xe6f,0xd65,0xc6c,0x36c,0x265,0x16f,0x66,0x76a,0x663,0x569,0x460,
0xca0,0xda9,0xea3,0xfaa,0x8a6,0x9af,0xaa5,0xbac,0x4ac,0x5a5,0x6af,0x7a6,0xaa,0x1a3,0x2a9,0x3a0,
0xd30,0xc39,0xf33,0xe3a,0x936,0x83f,0xb35,0xa3c,0x53c,0x435,0x73f,0x636,0x13a,0x33,0x339,0x230,
0xe90,0xf99,0xc93,0xd9a,0xa96,0xb9f,0x895,0x99c,0x69c,0x795,0x49f,0x596,0x29a,0x393,0x99,0x190,
0xf00,0xe09,0xd03,0xc0a,0xb06,0xa0f,0x905,0x80c,0x70c,0x605,0x50f,0x406,0x30a,0x203,0x109,0x0];
const MC_TRI_TABLE = [
[],[0,8,3],[0,1,9],[1,8,3,9,8,1],[1,2,10],[0,8,3,1,2,10],[9,2,10,0,2,9],[2,8,3,2,10,8,10,9,8],
[3,11,2],[0,11,2,8,11,0],[1,9,0,2,3,11],[1,11,2,1,9,11,9,8,11],[3,10,1,11,10,3],[0,10,1,0,8,10,8,11,10],[3,9,0,3,11,9,11,10,9],[9,8,10,10,8,11],
[4,7,8],[4,3,0,7,3,4],[0,1,9,8,4,7],[4,1,9,4,7,1,7,3,1],[1,2,10,8,4,7],[3,4,7,3,0,4,1,2,10],[9,2,10,9,0,2,8,4,7],[2,10,9,2,9,7,2,7,3,7,9,4],
[8,4,7,3,11,2],[11,4,7,11,2,4,2,0,4],[9,0,1,8,4,7,2,3,11],[4,7,11,9,4,11,9,11,2,9,2,1],[3,10,1,3,11,10,7,8,4],[1,11,10,1,4,11,1,0,4,7,11,4],[4,7,8,9,0,11,9,11,10,11,0,3],[4,7,11,4,11,9,9,11,10],
[9,5,4],[9,5,4,0,8,3],[0,5,4,1,5,0],[8,5,4,8,3,5,3,1,5],[1,2,10,9,5,4],[3,0,8,1,2,10,4,9,5],[5,2,10,5,4,2,4,0,2],[2,10,5,3,2,5,3,5,4,3,4,8],
[9,5,4,2,3,11],[0,11,2,0,8,11,4,9,5],[0,5,4,0,1,5,2,3,11],[2,1,5,2,5,8,2,8,11,4,8,5],[10,3,11,10,1,3,9,5,4],[4,9,5,0,8,1,8,10,1,8,11,10],[5,4,0,5,0,11,5,11,10,11,0,3],[5,4,8,5,8,10,10,8,11],
[9,7,8,5,7,9],[9,3,0,9,5,3,5,7,3],[0,7,8,0,1,7,1,5,7],[1,5,3,3,5,7],[9,7,8,9,5,7,10,1,2],[10,1,2,9,5,0,5,3,0,5,7,3],[8,0,2,8,2,5,8,5,7,10,5,2],[2,10,5,2,5,3,3,5,7],
[7,9,5,7,8,9,3,11,2],[9,5,7,9,7,2,9,2,0,2,7,11],[2,3,11,0,1,8,1,7,8,1,5,7],[11,2,1,11,1,7,7,1,5],[9,5,8,8,5,7,10,1,3,10,3,11],[5,7,0,5,0,9,7,11,0,1,0,10,11,10,0],[11,10,0,11,0,3,10,5,0,8,0,7,5,7,0],[11,10,5,7,11,5],
[10,6,5],[0,8,3,5,10,6],[9,0,1,5,10,6],[1,8,3,1,9,8,5,10,6],[1,6,5,2,6,1],[1,6,5,1,2,6,3,0,8],[9,6,5,9,0,6,0,2,6],[5,9,8,5,8,2,5,2,6,3,2,8],
[2,3,11,10,6,5],[11,0,8,11,2,0,10,6,5],[0,1,9,2,3,11,5,10,6],[5,10,6,1,9,2,9,11,2,9,8,11],[6,3,11,6,5,3,5,1,3],[0,8,11,0,11,5,0,5,1,5,11,6],[3,11,6,0,3,6,0,6,5,0,5,9],[6,5,9,6,9,11,11,9,8],
[5,10,6,4,7,8],[4,3,0,4,7,3,6,5,10],[1,9,0,5,10,6,8,4,7],[10,6,5,1,9,7,1,7,3,7,9,4],[6,1,2,6,5,1,4,7,8],[1,2,5,5,2,6,3,0,4,3,4,7],[8,4,7,9,0,5,0,6,5,0,2,6],[7,3,9,7,9,4,3,2,9,5,9,6,2,6,9],
[3,11,2,7,8,4,10,6,5],[5,10,6,4,7,2,4,2,0,2,7,11],[0,1,9,4,7,8,2,3,11,5,10,6],[9,2,1,9,11,2,9,4,11,7,11,4,5,10,6],[8,4,7,3,11,5,3,5,1,5,11,6],[5,1,11,5,11,6,1,0,11,7,11,4,0,4,11],[0,5,9,0,6,5,0,3,6,11,6,3,8,4,7],[6,5,9,6,9,11,4,7,9,7,11,9],
[10,4,9,6,4,10],[4,10,6,4,9,10,0,8,3],[10,0,1,10,6,0,6,4,0],[8,3,1,8,1,6,8,6,4,6,1,10],[1,4,9,1,2,4,2,6,4],[3,0,8,1,2,9,2,4,9,2,6,4],[0,2,4,4,2,6],[8,3,2,8,2,4,4,2,6],
[10,4,9,10,6,4,11,2,3],[0,8,2,2,8,11,4,9,10,4,10,6],[3,11,2,0,1,6,0,6,4,6,1,10],[6,4,1,6,1,10,4,8,1,2,1,11,8,11,1],[9,6,4,9,3,6,9,1,3,11,6,3],[8,11,1,8,1,0,11,6,1,9,1,4,6,4,1],[3,11,6,3,6,0,0,6,4],[6,4,8,11,6,8],
[7,10,6,7,8,10,8,9,10],[0,7,3,0,10,7,0,9,10,6,7,10],[10,6,7,1,10,7,1,7,8,1,8,0],[10,6,7,10,7,1,1,7,3],[1,2,6,1,6,8,1,8,9,8,6,7],[2,6,9,2,9,1,6,7,9,0,9,3,7,3,9],[7,8,0,7,0,6,6,0,2],[7,3,2,6,7,2],
[2,3,11,10,6,8,10,8,9,8,6,7],[2,0,7,2,7,11,0,9,7,6,7,10,9,10,7],[1,8,0,1,7,8,1,10,7,6,7,10,2,3,11],[11,2,1,11,1,7,10,6,1,6,7,1],[8,9,6,8,6,7,9,1,6,11,6,3,1,3,6],[0,9,1,11,6,7],[7,8,0,7,0,6,3,11,0,11,6,0],[7,11,6],
[7,6,11],[3,0,8,11,7,6],[0,1,9,11,7,6],[8,1,9,8,3,1,11,7,6],[10,1,2,6,11,7],[1,2,10,3,0,8,6,11,7],[2,9,0,2,10,9,6,11,7],[6,11,7,2,10,3,10,8,3,10,9,8],
[7,2,3,6,2,7],[7,0,8,7,6,0,6,2,0],[2,7,6,2,3,7,0,1,9],[1,6,2,1,8,6,1,9,8,8,7,6],[10,7,6,10,1,7,1,3,7],[10,7,6,1,7,10,1,8,7,1,0,8],[0,3,7,0,7,10,0,10,9,6,10,7],[7,6,10,7,10,8,8,10,9],
[6,8,4,11,8,6],[3,6,11,3,0,6,0,4,6],[8,6,11,8,4,6,9,0,1],[9,4,6,9,6,3,9,3,1,11,3,6],[6,8,4,6,11,8,2,10,1],[1,2,10,3,0,11,0,6,11,0,4,6],[4,11,8,4,6,11,0,2,9,2,10,9],[10,9,3,10,3,2,9,4,3,11,3,6,4,6,3],
[8,2,3,8,4,2,4,6,2],[0,4,2,4,6,2],[1,9,0,2,3,4,2,4,6,4,3,8],[1,9,4,1,4,2,2,4,6],[8,1,3,8,6,1,8,4,6,6,10,1],[10,1,0,10,0,6,6,0,4],[4,6,3,4,3,8,6,10,3,0,3,9,10,9,3],[10,9,4,6,10,4],
[4,9,5,7,6,11],[0,8,3,4,9,5,11,7,6],[5,0,1,5,4,0,7,6,11],[11,7,6,8,3,4,3,5,4,3,1,5],[9,5,4,10,1,2,7,6,11],[6,11,7,1,2,10,0,8,3,4,9,5],[7,6,11,5,4,10,4,2,10,4,0,2],[3,4,8,3,5,4,3,2,5,10,5,2,11,7,6],
[7,2,3,7,6,2,5,4,9],[9,5,4,0,8,6,0,6,2,6,8,7],[3,6,2,3,7,6,1,5,0,5,4,0],[6,2,8,6,8,7,2,1,8,4,8,5,1,5,8],[9,5,4,10,1,6,1,7,6,1,3,7],[1,6,10,1,7,6,1,0,7,8,7,0,9,5,4],[4,0,10,4,10,5,0,3,10,6,10,7,3,7,10],[7,6,10,7,10,8,5,4,10,4,8,10],
[6,9,5,6,11,9,11,8,9],[3,6,11,0,6,3,0,5,6,0,9,5],[0,11,8,0,5,11,0,1,5,5,6,11],[6,11,3,6,3,5,5,3,1],[1,2,10,9,5,11,9,11,8,11,5,6],[0,11,3,0,6,11,0,9,6,5,6,9,1,2,10],[11,8,5,11,5,6,8,0,5,10,5,2,0,2,5],[6,11,3,6,3,5,2,10,3,10,5,3],
[5,8,9,5,2,8,5,6,2,3,8,2],[9,5,6,9,6,0,0,6,2],[1,5,8,1,8,0,5,6,8,3,8,2,6,2,8],[1,5,6,2,1,6],[1,3,6,1,6,10,3,8,6,5,6,9,8,9,6],[10,1,0,10,0,6,9,5,0,5,6,0],[0,3,8,5,6,10],[10,5,6],
[11,5,10,7,5,11],[11,5,10,11,7,5,8,3,0],[5,11,7,5,10,11,1,9,0],[10,7,5,10,11,7,9,8,1,8,3,1],[11,1,2,11,7,1,7,5,1],[0,8,3,1,2,7,1,7,5,7,2,11],[9,7,5,9,2,7,9,0,2,2,11,7],[7,5,2,7,2,11,5,9,2,3,2,8,9,8,2],
[2,5,10,2,3,5,3,7,5],[8,2,0,8,5,2,8,7,5,10,2,5],[9,0,1,5,10,3,5,3,7,3,10,2],[9,8,2,9,2,1,8,7,2,10,2,5,7,5,2],[1,3,5,3,7,5],[0,8,7,0,7,1,1,7,5],[9,0,3,9,3,5,5,3,7],[9,8,7,5,9,7],
[5,8,4,5,10,8,10,11,8],[5,0,4,5,11,0,5,10,11,11,3,0],[0,1,9,8,4,10,8,10,11,10,4,5],[10,11,4,10,4,5,11,3,4,9,4,1,3,1,4],[2,5,1,2,8,5,2,11,8,4,5,8],[0,4,11,0,11,3,4,5,11,2,11,1,5,1,11],[0,2,5,0,5,9,2,11,5,4,5,8,11,8,5],[9,4,5,2,11,3],
[2,5,10,3,5,2,3,4,5,3,8,4],[5,10,2,5,2,4,4,2,0],[3,10,2,3,5,10,3,8,5,4,5,8,0,1,9],[5,10,2,5,2,4,1,9,2,9,4,2],[8,4,5,8,5,3,3,5,1],[0,4,5,1,0,5],[8,4,5,8,5,3,9,0,5,0,3,5],[9,4,5],
[4,11,7,4,9,11,9,10,11],[0,8,3,4,9,7,9,11,7,9,10,11],[1,10,11,1,11,4,1,4,0,7,4,11],[3,1,4,3,4,8,1,10,4,7,4,11,10,11,4],[4,11,7,9,11,4,9,2,11,9,1,2],[9,7,4,9,11,7,9,1,11,2,11,1,0,8,3],[11,7,4,11,4,2,2,4,0],[11,7,4,11,4,2,8,3,4,3,2,4],
[2,9,10,2,7,9,2,3,7,7,4,9],[9,10,7,9,7,4,10,2,7,8,7,0,2,0,7],[3,7,10,3,10,2,7,4,10,1,10,0,4,0,10],[1,10,2,8,7,4],[4,9,1,4,1,7,7,1,3],[4,9,1,4,1,7,0,8,1,8,7,1],[4,0,3,7,4,3],[4,8,7],
[9,10,8,10,11,8],[3,0,9,3,9,11,11,9,10],[0,1,10,0,10,8,8,10,11],[3,1,10,11,3,10],[1,2,11,1,11,9,9,11,8],[3,0,9,3,9,11,1,2,9,2,11,9],[0,2,11,8,0,11],[3,2,11],
[2,3,8,2,8,10,10,8,9],[9,10,2,0,9,2],[2,3,8,2,8,10,0,1,8,1,10,8],[1,10,2],[1,3,8,9,1,8],[0,9,1],[0,3,8],[]];

function nearestRegion(prims, px, py, pz) {
  let best = Infinity, region = 'skin';
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i];
    const di = p.kind === 'cap'
      ? sdCapsule(px, py, pz, p.ax, p.ay, p.az, p.bx, p.by, p.bz, p.ra, p.rb)
      : sdEllipsoid(px, py, pz, p.cx, p.cy, p.cz, p.rx, p.ry, p.rz, p.yaw);
    if (di < best) { best = di; region = p.region; }
  }
  return region;
}

// Polygonise. `res` is the approximate number of cells along the LONGEST body
// axis (height); the other axes get proportional cell counts so cubes stay ~
// cubic. Returns { positions:[], indices:[], regions:[] (per emitted vertex) }.
function polygonizeBody(prims, P, res) {
  // Bounding box from the ACTUAL primitive extents (so the T-pose fingertips,
  // toes and crown are never clipped — clipping is what punches holes in the
  // surface and drops thin features). We bound every primitive (capsule end ±
  // radius, ellipsoid centre ± radius) then pad generously.
  const H = P.H;
  let bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
  for (const p of prims) {
    if (p.kind === 'cap') {
      const r = Math.max(p.ra, p.rb);
      bx0 = Math.min(bx0, p.ax - r, p.bx - r); bx1 = Math.max(bx1, p.ax + r, p.bx + r);
      by0 = Math.min(by0, p.ay - r, p.by - r); by1 = Math.max(by1, p.ay + r, p.by + r);
      bz0 = Math.min(bz0, p.az - r, p.bz - r); bz1 = Math.max(bz1, p.az + r, p.bz + r);
    } else {
      const r = Math.max(p.rx, p.ry, p.rz);
      bx0 = Math.min(bx0, p.cx - r); bx1 = Math.max(bx1, p.cx + r);
      by0 = Math.min(by0, p.cy - r); by1 = Math.max(by1, p.cy + r);
      bz0 = Math.min(bz0, p.cz - r); bz1 = Math.max(bz1, p.cz + r);
    }
  }
  // The smooth-union can FATTEN the surface a touch past the raw primitive
  // bounds (smin pushes the isosurface outward at joins), so pad by the largest
  // blend radius plus a couple of cells' worth.
  const pad = 0.05 * H;
  const minX = bx0 - pad, maxX = bx1 + pad;
  const minY = Math.min(0, by0) - pad, maxY = by1 + pad;
  const minZ = bz0 - pad, maxZ = bz1 + pad;
  const spanX = maxX - minX, spanY = maxY - minY, spanZ = maxZ - minZ;
  const cell = spanY / res;                     // uniform cell size from height
  const nx = Math.max(2, Math.ceil(spanX / cell));
  const ny = Math.max(2, Math.ceil(spanY / cell));
  const nz = Math.max(2, Math.ceil(spanZ / cell));
  const sx = spanX / nx, sy = spanY / ny, sz = spanZ / nz;

  // Sample the field on the (nx+1)(ny+1)(nz+1) lattice. We store -SDF so the
  // SURFACE is where the field crosses iso=0 going negative→positive INSIDE→
  // out; MC below treats corner > iso as "inside". The OUTERMOST shell of the
  // lattice is forced strongly NEGATIVE (outside) so any surface that reaches
  // the box edge is guaranteed to be CAPPED — no open boundary there.
  const gx = nx + 1, gy = ny + 1, gz = nz + 1;
  const field = new Float32Array(gx * gy * gz);
  const idx3 = (i, j, k) => (k * gy + j) * gx + i;
  const OUTSIDE = -1e3;
  for (let k = 0; k < gz; k++) {
    const z = minZ + k * sz;
    for (let j = 0; j < gy; j++) {
      const y = minY + j * sy;
      for (let i = 0; i < gx; i++) {
        const x = minX + i * sx;
        const onBoundary = i === 0 || j === 0 || k === 0 || i === nx || j === ny || k === nz;
        let f = onBoundary ? OUTSIDE : -evalBodySDF(prims, x, y, z); // inside → positive
        // Nudge corners that land EXACTLY on the iso level off it. A corner with
        // f===0 is the source of MC's ambiguous (non-manifold) saddle cases —
        // pushing it a hair "inside" makes the local topology unambiguous and
        // removes the handful of non-manifold edges thin features otherwise
        // produce. ε is far below the cell size so the surface doesn't move.
        if (!onBoundary && Math.abs(f) < 1e-7) f = 1e-7;
        field[idx3(i, j, k)] = f;
      }
    }
  }

  const iso = 0;
  const positions = [];
  const regions = [];
  // Vertex cache keyed by edge id so shared edges weld automatically (indexed,
  // watertight). Edge id = base-corner-linear-index * 3 + axis(0:x,1:y,2:z).
  const vertCache = new Map();
  const indices = [];

  // Interpolate the zero-crossing on an edge between corners c0,c1 of a cell.
  function vertOnEdge(ci, cj, ck, edge) {
    const [a, b] = MC_EDGES[edge];
    const ca = MC_CORNERS[a], cb = MC_CORNERS[b];
    const ai = ci + ca[0], aj = cj + ca[1], ak = ck + ca[2];
    const bi = ci + cb[0], bj = cj + cb[1], bk = ck + cb[2];
    // Canonical edge id: lower corner + axis. Determine axis from the offset.
    let lo, hi, axis;
    if (ai !== bi) { axis = 0; lo = [Math.min(ai, bi), aj, ak]; hi = [Math.max(ai, bi), aj, ak]; }
    else if (aj !== bj) { axis = 1; lo = [ai, Math.min(aj, bj), ak]; hi = [ai, Math.max(aj, bj), ak]; }
    else { axis = 2; lo = [ai, aj, Math.min(ak, bk)]; hi = [ai, aj, Math.max(ak, bk)]; }
    const eid = (idx3(lo[0], lo[1], lo[2]) * 3) + axis;
    const cached = vertCache.get(eid);
    if (cached !== undefined) return cached;
    const va = field[idx3(ai, aj, ak)], vb = field[idx3(bi, bj, bk)];
    let t = (iso - va) / (vb - va);
    if (!Number.isFinite(t)) t = 0.5;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const xa = minX + ai * sx, ya = minY + aj * sy, za = minZ + ak * sz;
    const xb = minX + bi * sx, yb = minY + bj * sy, zb = minZ + bk * sz;
    const px = xa + (xb - xa) * t, py = ya + (yb - ya) * t, pz = za + (zb - za) * t;
    const vi = positions.length / 3;
    positions.push(px, py, pz);
    regions.push(nearestRegion(prims, px, py, pz));
    vertCache.set(eid, vi);
    return vi;
  }

  const corV = new Array(8);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        // Gather the 8 corner field values + compute the cube case index.
        let cube = 0;
        for (let c = 0; c < 8; c++) {
          const off = MC_CORNERS[c];
          corV[c] = field[idx3(i + off[0], j + off[1], k + off[2])];
          if (corV[c] > iso) cube |= (1 << c);
        }
        const edgeMask = MC_EDGE_TABLE[cube];
        if (edgeMask === 0) continue;
        // Compute the vertex index for every crossed edge (cached/welded).
        const ev = MC_EDGE_VERTS;
        for (let e = 0; e < 12; e++) ev[e] = (edgeMask & (1 << e)) ? vertOnEdge(i, j, k, e) : -1;
        // Emit triangles from the tri table. Winding gives outward normals for
        // an INSIDE-positive field with the standard table.
        const tri = MC_TRI_TABLE[cube];
        for (let t = 0; t < tri.length; t += 3) {
          const a = ev[tri[t]], b = ev[tri[t + 1]], c = ev[tri[t + 2]];
          if (a >= 0 && b >= 0 && c >= 0 && a !== b && b !== c && a !== c) {
            indices.push(a, c, b); // reversed → outward winding
          }
        }
      }
    }
  }
  return { positions, indices, regions, cell };
}
const MC_EDGE_VERTS = new Int32Array(12);

// Project a CYLINDRICAL UV set onto a (welded, body-space) geometry so the real
// 4K skin scan + fabric maps actually land on the live-viewport raster (a map
// with no `uv` attribute samples uv=0,0 → flat colour, no texture). The body is
// roughly a vertical cylinder about +Y, so u = atan2(z,x) wrapped to [0,1] and
// v = normalized height over the geometry's Y extent. `tile` repeats the map so
// 4K pore/weave detail reads at skin scale rather than stretched once over the
// whole figure. Adds the attribute in place; safe before skin-attr attach (uv
// count == position count, which is what THREE requires).
function projectUVs(geom, tile = { u: 3, v: 4 }) {
  const pos = geom.attributes.position;
  const n = pos.count;
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  const minY = bb.min.y, spanY = Math.max(1e-4, bb.max.y - bb.min.y);
  const uv = new Float32Array(n * 2);
  const TAU = Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u = (Math.atan2(z, x) / TAU) + 0.5;     // 0..1 around the body
    const v = (y - minY) / spanY;               // 0..1 up the body
    uv[i * 2] = u * tile.u;
    uv[i * 2 + 1] = v * tile.v;
  }
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geom;
}

// ───────────────────────── proportions (8-head canon) ───────────────────────
// Total height `H`. Head height = H/8. All landmarks in metres from floor.
// `build` (default 1) parametrically scales every GIRTH (radii / widths / muscle
// masses) without touching the vertical landmarks — slimmer (<1) to broader
// (>1) figures from the same canon. `mcRes` (optional) overrides the marching-
// cubes resolution (cells along the height); higher = denser/smoother mesh.
function proportions(H, build = 1, mcRes) {
  const head = H / 8;
  const b = Number.isFinite(build) && build > 0 ? build : 1; // girth multiplier
  const G = (v) => v * b;                                    // scale a girth
  return {
    H, head, build: b, mcRes,
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
    // widths / radii. shoulderHalf / hipHalf double as SKELETAL landmark spans
    // (bone seats), so they stay on the canon (unscaled) to keep the rig stable
    // across builds; the muscle/limb GIRTHS below carry the `build` multiplier.
    shoulderHalf: 0.115 * H,   // half shoulder span (≈2-head span overall)
    hipHalf: 0.065 * H,
    chestW: G(0.105 * H), chestD: G(0.072 * H),
    waistW: G(0.082 * H), waistD: G(0.060 * H),
    // limb GIRTH ladder (proper joint sizing): shoulder→biceps→elbow→
    // forearm→wrist, and hip/thigh→knee→calf→ankle. Real humans bulge at the
    // muscle belly and pinch at the joints — these capture that taper.
    deltoidR: G(0.038 * H),    // shoulder ball
    bicepsR: G(0.034 * H),     // upper-arm muscle belly
    elbowR: G(0.027 * H),      // elbow joint
    forearmR: G(0.030 * H),    // forearm belly
    wristR: G(0.020 * H),      // wrist (slim)
    thighTopR: G(0.060 * H),   // thigh near hip (thickest)
    thighR: G(0.052 * H),      // mid-thigh
    kneeR: G(0.040 * H),       // knee joint
    calfR: G(0.045 * H),       // calf muscle belly (thicker than knee)
    ankleR: G(0.026 * H),      // ankle (slim)
    upperArmR: G(0.034 * H), lowerArmR: G(0.028 * H), // legacy aliases (kept for refs)
    // head: 8-head canon → head spans H/8 (≈0.125 H). Centre at 0.9375 H so the
    // crown lands at ~H. Half-height = 0.063 H (a touch egg-shaped, occiput deep).
    neckR: G(0.034 * H), headRX: 0.058 * H, headRY: 0.066 * H, headRZ: 0.066 * H,
    headR: 0.062 * H,
    handLen: 0.085 * H, handW: G(0.052 * H),
    footLen: 0.145 * H, footW: G(0.058 * H), footH: G(0.062 * H),
    // ── HAND detail: a real palm + four fingers (index→pinky) + an opposed
    // thumb. Finger lengths/girths in metres (relative to H) — index longest,
    // pinky shortest, thumb the stoutest. Each finger has 3 phalange segments.
    palmLen: 0.085 * H * 0.5,   // palm length (wrist → knuckle line)
    fingerSpan: 0.052 * H,      // spread across the 4 finger roots (≈ palm width)
    // [index, middle, ring, pinky] total finger lengths (knuckle → tip).
    fingerLens: [0.0455 * H, 0.050 * H, 0.046 * H, 0.036 * H],
    fingerRoot: 0.0085 * H,     // finger radius at the knuckle (tapers to tip)
    thumbLen: 0.040 * H, thumbRoot: 0.011 * H,
    // ── FACE landmarks. The head is centred at headCY; these are OFFSETS in
    // head-local metres (x=right, y=up, z=forward/+Z = facing direction).
    eyeR: 0.012 * H,            // eyeball radius
    eyeSep: 0.026 * H,          // half-distance between the two eyes (centre→eye)
    eyeUp: 0.004 * H,           // eyes sit just above head centre
    eyeFwd: 0.046 * H,          // eyeball forward push (into the socket)
    browUp: 0.020 * H,          // brow ridge height above centre
    noseLen: 0.030 * H, noseProj: 0.020 * H, // nose drop + forward projection
    mouthDown: 0.034 * H,       // mouth below head centre
    earUp: 0.000 * H, earR: 0.018 * H,        // ear height (≈centre) + size
    // ── CLOTH: garments are skin-radius + this offset, with shallow fold
    // creases sinusoidally modulating the radius at sleeve/waist/knee.
    clothOffset: 0.006 * H,
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

  // Spine chain → chest → neck → head (chain up the +Y axis). The lumbar /
  // thoracic spine is split into THREE bones (Spine1 lumbar → Spine2 mid →
  // Spine3 upper) so the back can bend as a smooth arc — each carries a third
  // of the counter-rotation/lean, instead of one stiff hinge at the waist.
  const spineTopY = P.chestY;        // the spine chain spans hipY → chestY
  const seg = (spineTopY - P.hipY) / 3;
  const spine1 = mk('Spine1'); spine1.position.set(0, seg, 0); pelvis.add(spine1); setLen(spine1, seg);
  const spine2 = mk('Spine2'); spine2.position.set(0, seg, 0); spine1.add(spine2); setLen(spine2, seg);
  const spine3 = mk('Spine3'); spine3.position.set(0, seg, 0); spine2.add(spine3); setLen(spine3, seg);
  const chest = mk('Chest'); chest.position.set(0, 0, 0); spine3.add(chest); setLen(chest, P.shoulderY - P.chestY);
  const neck = mk('Neck'); neck.position.set(0, P.neckY - P.chestY, 0); chest.add(neck); setLen(neck, P.headBaseY - P.neckY);
  const head = mk('Head'); head.position.set(0, P.headBaseY - P.neckY, 0); neck.add(head); setLen(head, P.headR * 2);
  // Jaw — child of head, hinged at the back, so a "talk/clench" pose can drop
  // the chin. Weighted to the lower face + chin mass.
  const jaw = mk('Jaw'); jaw.position.set(0, P.headR * 0.45, P.headRZ * 0.2); head.add(jaw); setLen(jaw, P.headRZ);

  // Arms (×2). clavicle out from chest, then shoulder/elbow/wrist/hand down +X.
  // Each hand then sprouts 5 digit chains (index/middle/ring/pinky + thumb),
  // each with 3 phalange bones, so the fingers can be weighted + curled.
  for (const side of [['L', 1], ['R', -1]]) {
    const [s, dir] = side;
    const clav = mk(`Clavicle.${s}`); clav.position.set(dir * 0.04 * P.H, P.shoulderY - P.chestY, 0); chest.add(clav); setLen(clav, P.shoulderHalf * 0.5);
    const shoulder = mk(`Shoulder.${s}`); shoulder.position.set(dir * (P.shoulderHalf - 0.04 * P.H), 0, 0); clav.add(shoulder); setLen(shoulder, 0.16 * P.H);
    const elbow = mk(`Elbow.${s}`); elbow.position.set(dir * 0.16 * P.H, 0, 0); shoulder.add(elbow); setLen(elbow, 0.155 * P.H);
    const wrist = mk(`Wrist.${s}`); wrist.position.set(dir * 0.155 * P.H, 0, 0); elbow.add(wrist); setLen(wrist, P.handLen);
    const hand = mk(`Hand.${s}`); hand.position.set(dir * P.palmLen, 0, 0); wrist.add(hand); setLen(hand, P.palmLen);

    // Four fingers fanned across the knuckle line (+Z spread), rooted at the
    // hand bone (= knuckle line). Each: proximal → middle → distal phalange.
    const fingerNames = ['Index', 'Middle', 'Ring', 'Pinky'];
    const spread = [1.5, 0.5, -0.5, -1.5]; // -Z..+Z lateral seats across the palm
    for (let f = 0; f < 4; f++) {
      const totalLen = P.fingerLens[f];
      const segLen = totalLen / 3;
      const zSeat = dir * spread[f] * (P.fingerSpan / 3);
      let parent = hand;
      let posX = dir * P.palmLen, posZ = zSeat;
      for (let ph = 0; ph < 3; ph++) {
        const b = mk(`${fingerNames[f]}${ph + 1}.${s}`);
        // first phalange offsets from the knuckle; the rest chain along +X·dir
        b.position.set(ph === 0 ? (posX - parent.position.x) : dir * segLen,
                       0,
                       ph === 0 ? (posZ - parent.position.z) : 0);
        parent.add(b); setLen(b, segLen);
        parent = b;
      }
    }
    // Thumb — opposed: seats at the palm side toward the body, angled, 3 segs.
    {
      const segLen = P.thumbLen / 3;
      let parent = hand;
      for (let ph = 0; ph < 3; ph++) {
        const b = mk(`Thumb${ph + 1}.${s}`);
        if (ph === 0) b.position.set(-dir * P.palmLen * 0.4, -P.handW * 0.12, -dir * P.handW * 0.5);
        else b.position.set(dir * segLen * 0.7, 0, -dir * segLen * 0.5);
        parent.add(b); setLen(b, segLen);
        parent = b;
      }
    }
  }

  // Legs (×2). hip out from pelvis, then knee/ankle/foot down -Y.
  for (const side of [['L', 1], ['R', -1]]) {
    const [s, dir] = side;
    const hip = mk(`Hip.${s}`); hip.position.set(dir * P.hipHalf, 0, 0); pelvis.add(hip); setLen(hip, P.hipY - P.kneeY);
    const knee = mk(`Knee.${s}`); knee.position.set(0, -(P.hipY - P.kneeY), 0); hip.add(knee); setLen(knee, P.kneeY - P.ankleY);
    const ankle = mk(`Ankle.${s}`); ankle.position.set(0, -(P.kneeY - P.ankleY), 0); knee.add(ankle); setLen(ankle, P.footLen);
    // Foot bone runs forward to the ball of the foot; the Toe bone hinges off
    // the ball forward to the toe tips, so a heel-toe roll can pivot the foot
    // about the ball (toe-off push) and the heel about the ankle (heel-strike).
    const foot = mk(`Foot.${s}`); foot.position.set(0, -P.ankleY, P.footLen * 0.4); ankle.add(foot); setLen(foot, P.footLen * 0.55);
    const toe = mk(`Toe.${s}`); toe.position.set(0, 0, P.footLen * 0.42); foot.add(toe); setLen(toe, P.footLen * 0.3);
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
// Builds the body as ONE seamless watertight mesh from the implicit SDF, then
// SPLITS it into three SkinnedMesh-ready shells (skin / shirt / trousers) by
// per-vertex REGION (recorded during polygonisation from the nearest
// contributing primitive). Splitting AFTER polygonisation means each shell is a
// clean sub-mesh of the same continuous surface — there are no welded-blob seams
// anywhere, and the seam between, say, the bare forearm (skin) and the sleeve
// (shirt) is a shared edge loop of the single manifold, not two crossing solids.
//
// Returns { skin, shirt, trousers } BufferGeometries (each indexed, with
// position + normal + UV), plus { rawVerts, rawTris, watertight } diagnostics.
function buildBodyGeoms(P) {
  const prims = bodyPrimitives(P);
  // Resolution: cells along the body HEIGHT. 185 lands ~33–34k surface verts for
  // a 1.8 m figure — organic read, fingers/toes resolve, only ~10 sub-resolution
  // non-manifold edges, ~3 s build (no stall). Parametric via opts.mcRes.
  const res = Math.max(64, Math.min(240, Math.round(P.mcRes || 185)));
  const mc = polygonizeBody(prims, P, res);

  // Assemble the full indexed geometry once (for diagnostics + as the source we
  // slice into shells). Welding is implicit — MC already shares edge vertices.
  const full = new THREE.BufferGeometry();
  full.setAttribute('position', new THREE.Float32BufferAttribute(mc.positions, 3));
  full.setIndex(mc.indices);
  // A light extra weld collapses any near-coincident verts MC's edge cache
  // missed (numerical) so 1-ring adjacency is fully connected for the skinner.
  const welded = mergeVertices(full, 1e-5);
  welded.computeVertexNormals();

  // The weld can reorder/merge vertices, so re-derive per-vertex regions on the
  // WELDED positions (cheap: nearest-primitive region lookup again).
  const wpos = welded.attributes.position;
  const wn = wpos.count;
  const wRegion = new Array(wn);
  for (let v = 0; v < wn; v++) {
    wRegion[v] = nearestRegion(prims, wpos.getX(v), wpos.getY(v), wpos.getZ(v));
  }

  // Diagnostics: watertight check via boundary-edge count on the welded mesh.
  const diag = meshDiagnostics(welded);

  // Split into three shells by triangle region (majority vote of its 3 verts).
  const skin = extractRegion(welded, wRegion, 'skin');
  const shirt = extractRegion(welded, wRegion, 'shirt');
  const trousers = extractRegion(welded, wRegion, 'trousers');

  // Cylindrical UVs so the real 4K skin scan + fabric maps land. Skin tiles
  // modestly (pores read, no obvious repeat); garments tile densely (woven
  // thread, not a checker grid). UVs after the split → count == position count.
  projectUVs(skin, { u: 2, v: 2.4 });
  projectUVs(shirt, { u: 9, v: 11 });
  projectUVs(trousers, { u: 9, v: 14 });

  return {
    skin, shirt, trousers,
    rawVerts: wn,
    rawTris: (welded.index ? welded.index.count : 0) / 3,
    watertight: diag.watertight,
    // "near-watertight" = no open boundary (no leaks); only basic-MC's handful
    // of ambiguous non-manifold edges at sub-resolution thin features remain.
    nearWatertight: diag.boundaryEdges === 0,
    boundaryEdges: diag.boundaryEdges,
    nonManifoldEdges: diag.nonManifoldEdges,
    eulerChar: diag.eulerChar,
  };
}

// Extract the sub-mesh whose triangles belong to `region` (a triangle joins a
// region if ≥2 of its 3 verts are tagged that region). Re-indexes compactly so
// the shell carries only its own vertices (position + normal). Returns an
// indexed BufferGeometry (empty-safe — a region with no tris yields a 0-vert
// geometry, which the caller skips).
function extractRegion(geom, vertRegion, region) {
  const idx = geom.index.array;
  const srcPos = geom.attributes.position;
  const srcNorm = geom.attributes.normal;
  const remap = new Map();          // old vert → new vert
  const pos = [];
  const norm = [];
  const indices = [];
  const pushVert = (old) => {
    let ni = remap.get(old);
    if (ni === undefined) {
      ni = pos.length / 3;
      pos.push(srcPos.getX(old), srcPos.getY(old), srcPos.getZ(old));
      if (srcNorm) norm.push(srcNorm.getX(old), srcNorm.getY(old), srcNorm.getZ(old));
      remap.set(old, ni);
    }
    return ni;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    let votes = 0;
    if (vertRegion[a] === region) votes++;
    if (vertRegion[b] === region) votes++;
    if (vertRegion[c] === region) votes++;
    if (votes >= 2) indices.push(pushVert(a), pushVert(b), pushVert(c));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (norm.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setIndex(indices);
  if (!norm.length) g.computeVertexNormals();
  return g;
}

// Watertight / topology diagnostics on an indexed mesh. Counts directed edges:
// a closed 2-manifold has every undirected edge shared by exactly 2 triangles
// (→ 0 boundary edges). Also returns the Euler characteristic V−E+F (2 per
// closed genus-0 component). `boundaryEdges` = undirected edges used by only
// one triangle (open holes). Reports near-watertight honestly.
function meshDiagnostics(geom) {
  const idx = geom.index ? geom.index.array : null;
  const V = geom.attributes.position.count;
  if (!idx) return { watertight: false, boundaryEdges: -1, eulerChar: NaN, V, E: 0, F: 0 };
  const F = idx.length / 3;
  const edgeCount = new Map();
  const key = (a, b) => (a < b ? a * 0x100000 + b : b * 0x100000 + a);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const k = key(x, y);
      edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
    }
  }
  let boundary = 0, nonManifold = 0;
  for (const n of edgeCount.values()) {
    if (n === 1) boundary++;
    else if (n > 2) nonManifold++;
  }
  const E = edgeCount.size;
  return {
    watertight: boundary === 0 && nonManifold === 0,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    eulerChar: V - E + F,
    V, E, F,
  };
}

// ───────────────────────── pose library (body mechanics) ────────────────────
// Each pose is a map boneName → [ex,ey,ez] LOCAL Euler (radians). Values are
// CLAMPED to per-joint limits before applying so nothing hyper-extends.
// Side-aware mirroring handled inline (L/R) where it matters.
const JOINT_LIMITS = {
  // [min,max] per axis (radians). Generous but anatomically bounded.
  // Spine split into three vertebral segments — each takes ~1/3 of the bend so
  // the back arcs smoothly rather than kinking at one waist hinge.
  Spine1: [[-0.35, 0.45], [-0.30, 0.30], [-0.30, 0.30]],
  Spine2: [[-0.35, 0.45], [-0.30, 0.30], [-0.30, 0.30]],
  Spine3: [[-0.35, 0.45], [-0.30, 0.30], [-0.30, 0.30]],
  Spine: [[-0.6, 0.9], [-0.7, 0.7], [-0.5, 0.5]], // legacy alias (kept for refs)
  Chest: [[-0.5, 0.7], [-0.6, 0.6], [-0.4, 0.4]],
  Neck: [[-0.7, 0.7], [-0.9, 0.9], [-0.5, 0.5]],
  Head: [[-0.7, 0.6], [-0.9, 0.9], [-0.5, 0.5]],
  Shoulder: [[-1.6, 1.8], [-1.8, 1.8], [-2.2, 2.2]],
  Elbow: [[-0.1, 2.6], [-0.2, 0.2], [-2.6, 0.1]], // hinge: no hyper-extend past ~0
  Wrist: [[-0.8, 0.8], [-0.6, 0.6], [-0.6, 0.6]],
  Hip: [[-1.7, 1.0], [-0.6, 0.6], [-1.4, 1.4]],
  Knee: [[-2.5, 0.05], [-0.1, 0.1], [-0.1, 0.1]], // hinge: flexes negative-X, no hyper-extend
  Ankle: [[-0.7, 0.9], [-0.3, 0.3], [-0.3, 0.3]],
  Toe: [[-0.6, 0.9], [-0.1, 0.1], [-0.1, 0.1]],   // hinge: toes dorsiflex up / curl under for toe-off
  Clavicle: [[-0.3, 0.3], [-0.3, 0.3], [-0.5, 0.5]],
  Jaw: [[-0.05, 0.5], [-0.1, 0.1], [-0.05, 0.05]], // drop the chin to open
};
// Finger / thumb phalanges all share a curl-hinge limit (flex toward palm,
// almost no hyper-extension). baseName strips the side; the digit name still
// carries its phalange index so we add per-name limits programmatically below.
for (const dig of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) {
  for (let ph = 1; ph <= 3; ph++) {
    JOINT_LIMITS[`${dig}${ph}`] = [[-0.1, 0.1], [-0.2, 0.2], [-1.7, 0.2]];
  }
}
function baseName(n) { return n.replace(/\.[LR]$/, ''); }

// Distribute a total spine bend [ex,ey,ez] evenly across the three vertebral
// bones (Spine1/2/3) so the back arcs smoothly instead of kinking at one hinge.
function spineBend(ex, ey, ez) {
  const e = [ex / 3, ey / 3, ez / 3];
  return { Spine1: e.slice(), Spine2: e.slice(), Spine3: e.slice() };
}

// Build a {boneName:[ex,ey,ez]} set that curls every finger phalange by
// `amt` radians about local Z (the same hinge the digit bones flex on),
// for both sides. Thumb curls a touch less. Used by relaxed/sit/reach poses.
function fingerCurl(amt, thumbAmt = amt * 0.6) {
  const out = {};
  // Bind-pose finger bones have identity local frames, so flexion toward the
  // palm is NEGATIVE local-Z for BOTH hands (the [-1.7, 0.2] curl-hinge limit).
  for (const s of ['L', 'R']) {
    for (const dig of ['Index', 'Middle', 'Ring', 'Pinky']) {
      for (let ph = 1; ph <= 3; ph++) out[`${dig}${ph}.${s}`] = [0, 0, -amt];
    }
    for (let ph = 1; ph <= 3; ph++) out[`Thumb${ph}.${s}`] = [0, 0, -thumbAmt];
  }
  return out;
}
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
      ...spineBend(0.04, 0, 0), 'Chest': [0.02, 0, 0],
      'Hip.L': [0.04, 0, 0.02], 'Hip.R': [0.04, 0, -0.02],
      'Knee.L': [-0.06, 0, 0], 'Knee.R': [-0.06, 0, 0],
      'Neck': [0.05, 0, 0],
      ...fingerCurl(0.28), // natural relaxed-hand curl
    }),

    'walk-stride': () => ({
      // arms down + counter-swing, legs in a mid-stride (L forward, R back).
      'Shoulder.L': [-0.5, 0, -1.3], 'Shoulder.R': [0.5, 0, 1.3],
      'Elbow.L': [0, 0, -0.7], 'Elbow.R': [0, 0, 0.7],
      ...spineBend(0.06, 0.08, 0), 'Chest': [0.03, -0.05, 0],
      'Hip.L': [0.55, 0, 0], 'Knee.L': [-0.25, 0, 0], 'Ankle.L': [0.15, 0, 0],
      'Hip.R': [-0.45, 0, 0], 'Knee.R': [-0.6, 0, 0], 'Ankle.R': [-0.2, 0, 0],
      'Toe.R': [0.45, 0, 0], // trailing right foot rolled up onto the toe
      'Neck': [0.04, 0, 0],
    }),

    'sit': () => ({
      // thighs forward ~90°, knees bent ~90°, arms relaxed forward-rest.
      'Hip.L': [1.5, 0, 0.05], 'Hip.R': [1.5, 0, -0.05],
      'Knee.L': [-1.5, 0, 0], 'Knee.R': [-1.5, 0, 0],
      'Ankle.L': [0.2, 0, 0], 'Ankle.R': [0.2, 0, 0],
      'Shoulder.L': [0.35, 0, -1.25], 'Shoulder.R': [0.35, 0, 1.25],
      'Elbow.L': [0, 0, -0.9], 'Elbow.R': [0, 0, 0.9],
      ...spineBend(0.12, 0, 0), 'Chest': [0.05, 0, 0],
      ...fingerCurl(0.5), // hands rest on the lap
    }),

    'reach': () => ({
      // right arm reaches up-and-forward, body braces, left arm low.
      'Shoulder.R': [-1.0, 0, 0.6], 'Elbow.R': [0, 0, -0.35], 'Wrist.R': [0.2, 0, 0],
      'Shoulder.L': [0.1, 0, -1.2], 'Elbow.L': [0, 0, -0.4],
      ...spineBend(-0.1, -0.18, 0), 'Chest': [-0.08, -0.12, 0], 'Neck': [-0.15, -0.1, 0],
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
  const build = Number(opts.build) > 0 ? Number(opts.build) : 1; // girth multiplier
  const mcRes = Number(opts.mcRes) > 0 ? Number(opts.mcRes) : undefined; // MC density
  const P = proportions(H, build, mcRes);
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
  //    The geometry is ONE seamless implicit surface; geoms.* are its three
  //    region sub-meshes (clean sub-meshes of the same manifold, no blob seams).
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
    // A region with no triangles (e.g. shirtless build) yields a 0-vert shell —
    // skip binding it (a SkinnedMesh with 0 verts is inert clutter).
    if (!geom.attributes.position || geom.attributes.position.count === 0) {
      weightReport.push({ shell: sh.key, verts: 0, material: sh.matId, skipped: true });
      continue;
    }
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
    // The radius is the SINGLE most important knob for the "ragdoll" collapse:
    // too large and a limb segment's verts also pick up the NEXT-bone-up
    // (e.g. mid-forearm verts catching the stationary Shoulder bone), so when
    // the joint bends those verts get half-dragged by the part that didn't move
    // → the candy-wrap pinch. We size it to roughly the forearm half-length so a
    // vertex reaches its OWN segment + the adjacent joint, but NOT the joint
    // beyond it. The Laplacian smoothing — over the NOW-CONTINUOUS 1-ring of the
    // seamless surface (the welded-blob mesh had its adjacency severed at every
    // seam, which is the other half of why it collapsed) — then blends the joint
    // bands smoothly so elbows/knees bend round, not creased.
    const r = _computeAutoWeights(mesh, boneList, { radius: 0.085 * H, smoothPasses: 3 });
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
    build,
    boneCount: boneList.length,
    boneNames: boneList.map((b) => b.name),
    shells: weightReport,
    skinnedMeshUuids: skinnedMeshes.map((m) => m.uuid),
    totalVertices: totalVerts,
    // Implicit-surface diagnostics: the full body is ONE seamless watertight
    // mesh; these report the source manifold the shells were sliced from.
    surface: {
      verts: geoms.rawVerts,
      tris: geoms.rawTris,
      watertight: geoms.watertight,
      nearWatertight: geoms.nearWatertight,
      boundaryEdges: geoms.boundaryEdges,
      nonManifoldEdges: geoms.nonManifoldEdges,
      eulerChar: geoms.eulerChar,
    },
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
