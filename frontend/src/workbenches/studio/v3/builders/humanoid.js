// ArchDisc Studio V3 — Rigged Humanoid builder.
//
// buildHumanoid(opts) creates a GENUINE rigged biped in the LIVE viewport scene:
//
//   1. A HUMANOID MESH with real 8-head-canon proportions — a smooth body
//      built from high-resolution PROFILE SOLIDS (each limb swept along its
//      bone with a per-section girth ladder: thigh-belly→knee→calf→ankle,
//      biceps→elbow→forearm→wrist), a lathe-shaped torso (waist pinch → rib
//      bulge → shoulder yoke, elliptical not boxy), an anatomical ellipsoid
//      head + tapered neck, recognizable HANDS (flattened palm + mitten finger
//      block + thumb nub) and FEET (heel→arch→toe wedge, flat sole), NOT a
//      stack of stretched capsules. Limbs/torso/head/hands/feet are merged
//      (mergeGeometries + mergeVertices for connected 1-ring adjacency) into
//      three skinnable shells: SKIN (head/neck/hands), SHIRT (torso+arms),
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
// Everything below builds SMOOTH, higher-resolution profile solids instead of
// the old low-poly stretched-capsule "scarecrow". Limbs/torso are swept from a
// per-section radius PROFILE (an array of {t, rx, rz}) along +Y with rounded
// hemispherical caps, so a thigh can bulge then taper to the knee, the knee can
// have girth, and the calf can taper to a slim ankle — real joint girth, smooth
// silhouettes, no facets. The whole figure is later welded (mergeVertices) so
// the skin auto-weighter sees true 1-ring adjacency for its Laplacian smooth.

const RADIAL = 24; // radial segments — high enough to read round, not faceted.

function smooth(t) { return t * t * (3 - 2 * t); }
function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

// Sample an ascending profile (array of {t in [0,1], rx, rz}) at parameter t,
// smooth-interpolating the two bracketing control points.
function sampleProfile(profile, t) {
  t = clamp01(t);
  if (t <= profile[0].t) return { rx: profile[0].rx, rz: profile[0].rz };
  const last = profile[profile.length - 1];
  if (t >= last.t) return { rx: last.rx, rz: last.rz };
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i];
    if (t <= b.t) {
      const u = smooth((t - a.t) / Math.max(1e-6, b.t - a.t));
      return {
        rx: THREE.MathUtils.lerp(a.rx, b.rx, u),
        rz: THREE.MathUtils.lerp(a.rz, b.rz, u),
      };
    }
  }
  return { rx: last.rx, rz: last.rz };
}

// A SMOOTH limb/torso solid swept along +Y over [0, len] with an elliptical
// (rx,rz) cross-section that follows `profile`, plus rounded hemispherical caps
// at both ends sized to the local radius. `rings` controls vertical resolution
// (more = smoother joint bulges). Returns an indexed BufferGeometry.
function profileSolid(profile, len, rings = 16, capRings = 5) {
  const positions = [];
  const indices = [];
  const radial = RADIAL;
  const rowOf = [];          // first vertex index of each ring row
  const r0 = sampleProfile(profile, 0);
  const r1 = sampleProfile(profile, 1);

  // ── bottom cap (hemisphere bulging to -Y), squashed to the base ellipse.
  for (let i = capRings; i >= 1; i--) {
    const phi = (i / capRings) * (Math.PI / 2); // 90°→ ~0
    const y = -Math.cos(phi) * Math.min(r0.rx, r0.rz);
    const ring = Math.sin(phi);
    rowOf.push(positions.length / 3);
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      positions.push(Math.cos(th) * r0.rx * ring, y, Math.sin(th) * r0.rz * ring);
    }
  }
  // ── body rings.
  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    const r = sampleProfile(profile, t);
    const y = t * len;
    rowOf.push(positions.length / 3);
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      positions.push(Math.cos(th) * r.rx, y, Math.sin(th) * r.rz);
    }
  }
  // ── top cap (hemisphere bulging to +Y).
  for (let i = 1; i <= capRings; i++) {
    const phi = (i / capRings) * (Math.PI / 2);
    const y = len + Math.sin(phi) * Math.min(r1.rx, r1.rz);
    const ring = Math.cos(phi);
    rowOf.push(positions.length / 3);
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      positions.push(Math.cos(th) * r1.rx * ring, y, Math.sin(th) * r1.rz * ring);
    }
  }

  // Stitch consecutive rings into quads (two tris).
  for (let row = 0; row < rowOf.length - 1; row++) {
    const a0 = rowOf[row], b0 = rowOf[row + 1];
    for (let j = 0; j < radial; j++) {
      const a = a0 + j, b = a0 + j + 1, c = b0 + j + 1, d = b0 + j;
      indices.push(a, d, b);
      indices.push(b, d, c);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// Smooth ellipsoid head — a UV sphere scaled per-axis (taller than wide, a
// touch deeper for an occiput) so it reads like a human cranium, not a ball.
function ellipsoid(rx, ry, rz) {
  const g = new THREE.SphereGeometry(1, RADIAL, 18);
  g.scale(rx, ry, rz);
  return g;
}

// A capsule-equivalent built from profileSolid (constant radius) — used for
// the neck. Keeps the welded-adjacency story consistent with the limbs.
function tube(radius, len, radTip = radius) {
  return profileSolid([{ t: 0, rx: radius, rz: radius }, { t: 1, rx: radTip, rz: radTip }], len, 6, 4);
}

// ── HAND: a flattened rounded palm block + a mitten finger block + a thumb
// nub. Built in LOCAL space (palm extends +X from the wrist, flattened on Y),
// returned as one welded geometry the caller positions/rotates onto the wrist.
function handGeom(P, dir) {
  const parts = [];
  const palmLen = P.handLen * 0.55;
  const palmW = P.handW;            // thickness across the palm (Z)
  const palmH = P.handW * 0.55;     // palm thickness top-bottom (Y)
  // palm: a short flattened profile solid along +X.
  const palm = profileSolid(
    [{ t: 0, rx: palmH * 0.55, rz: palmW * 0.5 },
     { t: 0.5, rx: palmH * 0.6, rz: palmW * 0.55 },
     { t: 1, rx: palmH * 0.55, rz: palmW * 0.5 }],
    palmLen, 8, 4);
  palm.rotateZ(-Math.PI / 2); // +Y sweep → +X sweep
  parts.push(palm);
  // fingers: one rounded mitten block continuing +X past the palm.
  const fingLen = P.handLen * 0.45;
  const fingers = profileSolid(
    [{ t: 0, rx: palmH * 0.5, rz: palmW * 0.46 },
     { t: 0.7, rx: palmH * 0.45, rz: palmW * 0.44 },
     { t: 1, rx: palmH * 0.36, rz: palmW * 0.4 }],
    fingLen, 7, 4);
  fingers.rotateZ(-Math.PI / 2);
  fingers.translate(palmLen, 0, 0);
  parts.push(fingers);
  // thumb: a small nub off the palm side (toward the body, +Z·dir·-1 ish).
  const thumb = tube(palmH * 0.32, P.handLen * 0.26, palmH * 0.24);
  thumb.rotateZ(-Math.PI / 2.6);
  thumb.translate(palmLen * 0.25, -palmH * 0.1, -dir * palmW * 0.42);
  parts.push(thumb);
  return mergeWeld(parts);
}

// ── FOOT: heel ball → arch → toe box, built as a forward-swept (+Z) profile
// solid that sits flat on the floor. Heel is rounded, toe tapers, sole flat.
function footGeom(P) {
  const len = P.footLen, w = P.footW, h = P.footH;
  // sweep along +Z (forward). profile gives width(rx after rotation)/height.
  const g = profileSolid(
    [{ t: 0.0, rx: h * 0.55, rz: w * 0.42 },   // heel (rounded, narrower)
     { t: 0.18, rx: h * 0.6,  rz: w * 0.5 },   // ankle ball
     { t: 0.5, rx: h * 0.48, rz: w * 0.52 },   // arch / midfoot (widest)
     { t: 0.82, rx: h * 0.4,  rz: w * 0.5 },   // ball of foot
     { t: 1.0, rx: h * 0.22, rz: w * 0.4 }],   // toe (tapered, low)
    len, 14, 4);
  // profileSolid sweeps +Y; rotate so length runs along +Z (forward).
  g.rotateX(Math.PI / 2);     // +Y → +Z
  // squash the bottom flat onto the floor: clamp y below sole to a flat sole.
  const pos = g.attributes.position;
  const sole = -h * 0.5;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < sole) pos.setY(i, sole);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// Merge + weld a list of geometries into one indexed, vertex-welded geometry
// with recomputed normals (real 1-ring adjacency for the skin smoother).
// We strip every attribute except `position` first so mixed sources (sphere
// has uv, profileSolid does not) merge cleanly — normals are recomputed and
// the skin weighter only needs positions.
function mergeWeld(parts) {
  const cleaned = parts.map((g) => {
    const ni = g.toNonIndexed();
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', ni.getAttribute('position'));
    return out;
  });
  const m = mergeGeometries(cleaned, false);
  const welded = mergeVertices(m, 1e-4);
  welded.computeVertexNormals();
  return welded;
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
    // limb GIRTH ladder (proper joint sizing): shoulder→biceps→elbow→
    // forearm→wrist, and hip/thigh→knee→calf→ankle. Real humans bulge at the
    // muscle belly and pinch at the joints — these capture that taper.
    deltoidR: 0.038 * H,       // shoulder ball
    bicepsR: 0.034 * H,        // upper-arm muscle belly
    elbowR: 0.027 * H,         // elbow joint
    forearmR: 0.030 * H,       // forearm belly
    wristR: 0.020 * H,         // wrist (slim)
    thighTopR: 0.060 * H,      // thigh near hip (thickest)
    thighR: 0.052 * H,         // mid-thigh
    kneeR: 0.040 * H,          // knee joint
    calfR: 0.045 * H,          // calf muscle belly (thicker than knee)
    ankleR: 0.026 * H,         // ankle (slim)
    upperArmR: 0.034 * H, lowerArmR: 0.028 * H, // legacy aliases (kept for refs)
    // head: 8-head canon → head spans H/8 (≈0.125 H). Centre at 0.9375 H so the
    // crown lands at ~H. Half-height = 0.063 H (a touch egg-shaped, occiput deep).
    neckR: 0.034 * H, headRX: 0.058 * H, headRY: 0.066 * H, headRZ: 0.066 * H,
    headR: 0.062 * H,
    handLen: 0.085 * H, handW: 0.052 * H,
    footLen: 0.145 * H, footW: 0.058 * H, footH: 0.062 * H,
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
//
// Every limb is a profileSolid with a GIRTH LADDER (multiple control radii)
// swept between the two joint points, then oriented onto the bind-pose segment.
// The torso is a lathe-style profile: pelvis → narrow waist → broad chest →
// shoulder line, elliptical (deeper than the old box). Result: a smooth,
// articulated body with real joint girth instead of stacked stretched capsules.
function buildBodyGeoms(P) {
  const skinParts = [];
  const shirtParts = [];
  const trouserParts = [];

  // HEAD (skin) — anatomical ellipsoid (taller than wide, slight occiput).
  {
    const g = ellipsoid(P.headRX, P.headRY, P.headRZ);
    g.translate(0, P.headCY, 0.004);
    skinParts.push(g);
  }
  // JAW/chin fill (skin) — small ellipsoid blending neck→head.
  {
    const g = ellipsoid(P.headRX * 0.72, P.headRX * 0.6, P.headRZ * 0.75);
    g.translate(0, P.headBaseY + P.headRX * 0.2, P.headRZ * 0.18);
    skinParts.push(g);
  }
  // NECK (skin) — smooth tapered tube from chest line up into the head base.
  {
    const len = (P.headBaseY - P.neckY) + 0.012 * P.H;
    const g = profileSolid(
      [{ t: 0, rx: P.neckR * 1.18, rz: P.neckR * 1.12 },  // trapezius base flare
       { t: 0.55, rx: P.neckR, rz: P.neckR * 0.96 },
       { t: 1, rx: P.neckR * 0.92, rz: P.neckR * 0.92 }],
      Math.max(0.02, len), 8, 4);
    g.translate(0, P.neckY - 0.01 * P.H, 0);
    skinParts.push(g);
  }

  // TORSO (shirt) — shaped lathe solid pelvis(waistY)→shoulder line, with a
  // rib-cage bulge and narrowed waist. Elliptical cross-section (W > D).
  {
    const h = P.shoulderY - P.waistY;
    const g = profileSolid(
      [{ t: 0.0,  rx: P.waistW * 1.04, rz: P.waistD * 1.06 }, // belly/waist
       { t: 0.18, rx: P.waistW * 0.96, rz: P.waistD * 0.98 }, // narrowest waist
       { t: 0.5,  rx: P.chestW * 0.96, rz: P.chestD * 1.0 },  // lower ribs
       { t: 0.78, rx: P.chestW,        rz: P.chestD },        // chest
       { t: 1.0,  rx: P.shoulderHalf * 0.86, rz: P.chestD * 0.86 }], // shoulder yoke
      h, 18, 5);
    g.translate(0, P.waistY, 0);
    shirtParts.push(g);
  }
  // SHOULDER deltoid caps (shirt) — round the join, smooth shoulder transition.
  for (const dir of [1, -1]) {
    const g = ellipsoid(P.deltoidR * 1.15, P.deltoidR * 1.1, P.deltoidR * 1.05);
    g.translate(dir * (P.shoulderHalf - P.deltoidR * 0.15), P.shoulderY, 0);
    shirtParts.push(g);
  }

  // ARMS (shirt sleeve = upper+lower arm; hands are skin).
  const upperArmLen = 0.16 * P.H, lowerArmLen = 0.155 * P.H;
  for (const dir of [1, -1]) {
    const shoulderX = dir * P.shoulderHalf, shoulderY = P.shoulderY;
    const elbowX = dir * (P.shoulderHalf + upperArmLen), elbowY = P.shoulderY;
    const wristX = dir * (P.shoulderHalf + upperArmLen + lowerArmLen), wristY = P.shoulderY;
    // upper arm: deltoid → biceps belly → elbow (taper to joint).
    shirtParts.push(segProfile(shoulderX, shoulderY, 0, elbowX, elbowY, 0,
      [{ t: 0, rx: P.deltoidR, rz: P.deltoidR },
       { t: 0.35, rx: P.bicepsR, rz: P.bicepsR },
       { t: 1, rx: P.elbowR, rz: P.elbowR * 0.95 }]));
    // forearm: elbow → forearm belly → slim wrist.
    shirtParts.push(segProfile(elbowX, elbowY, 0, wristX, wristY, 0,
      [{ t: 0, rx: P.elbowR, rz: P.elbowR * 0.95 },
       { t: 0.3, rx: P.forearmR, rz: P.forearmR * 0.92 },
       { t: 1, rx: P.wristR, rz: P.wristR * 0.85 }]));
    // hand (skin) — palm + mitten fingers + thumb, oriented +X·dir from wrist.
    const handG = handGeom(P, dir);
    if (dir < 0) handG.rotateY(Math.PI); // mirror to the left side
    handG.translate(wristX + dir * P.wristR, wristY, 0);
    skinParts.push(handG);
  }

  // PELVIS (trousers) — broad rounded hip block waist→hips, wider than waist.
  {
    const h = (P.waistY - P.hipY) + 0.05 * P.H;
    const g = profileSolid(
      [{ t: 0.0, rx: P.hipHalf * 1.55, rz: P.waistD * 1.1 },  // glutes / hip width
       { t: 0.5, rx: P.hipHalf * 1.5,  rz: P.waistD * 1.05 },
       { t: 1.0, rx: P.waistW * 1.0,   rz: P.waistD * 1.02 }], // up into waist
      Math.max(0.02, h), 8, 5);
    g.translate(0, P.hipY - 0.03 * P.H, 0);
    trouserParts.push(g);
  }

  // LEGS (trousers = thigh+calf; feet separate skin/shoe on the trouser shell).
  for (const dir of [1, -1]) {
    const hipX = dir * P.hipHalf, hipY = P.hipY;
    const kneeX = dir * P.hipHalf * 0.78, kneeY = P.kneeY;
    const ankleX = dir * P.hipHalf * 0.72, ankleY = P.ankleY;
    // thigh: thick at hip → muscle belly → knee joint.
    trouserParts.push(segProfile(hipX, hipY, 0, kneeX, kneeY, 0,
      [{ t: 0, rx: P.thighTopR, rz: P.thighTopR * 0.96 },
       { t: 0.4, rx: P.thighR, rz: P.thighR * 0.94 },
       { t: 1, rx: P.kneeR, rz: P.kneeR * 0.96 }]));
    // calf: knee → calf belly (thicker) → slim ankle.
    trouserParts.push(segProfile(kneeX, kneeY, 0, ankleX, ankleY, 0,
      [{ t: 0, rx: P.kneeR, rz: P.kneeR * 0.96 },
       { t: 0.3, rx: P.calfR, rz: P.calfR * 0.9 },
       { t: 1, rx: P.ankleR, rz: P.ankleR * 0.92 }]));
    // foot: heel→arch→toe wedge, sole flat on floor, forward (+Z).
    const fg = footGeom(P);
    fg.translate(ankleX, P.footH * 0.5, P.footLen * 0.28);
    trouserParts.push(fg);
  }

  return { skin: mergeWeld(skinParts), shirt: mergeWeld(shirtParts), trousers: mergeWeld(trouserParts) };
}

// A profileSolid spanning two world points a→b, swept with a girth `profile`
// (t along the segment, elliptical rx/rz). Oriented +Y→(a→b) then placed at a.
function segProfile(ax, ay, az, bx, by, bz, profile, rings = 14) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  const g = profileSolid(profile, Math.max(0.01, len), rings, 5);
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
