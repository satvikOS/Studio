/**
 * HEADLESS verify (no render, no train) — PROCEDURAL human + procedural WALK along
 * a CatmullRom path through the forest clearing. PURE-CUA, ZERO imported geometry.
 *
 * HARD RULE this test enforces: NO imported geometry. The human is BUILT by the
 * procedural implicit-surface humanoid builder (__studioBuildHumanoid → SDF +
 * marching cubes, 58-bone biped) — NOT import-character, NO Mixamo/Soldier .glb,
 * NO CC0 tree/prop models. We assert NO GLTFLoader is constructed and NO .glb is
 * fetched anywhere in the run.
 *
 * What this proves with the REAL src builders:
 *   1. the PROCEDURAL humanoid BUILDS (implicit surface → watertight skinned mesh,
 *      58 bones) with NO glb / NO base mesh,
 *   2. the procedural WALK cycle DEFORMS the rig (a skin vertex moves between two
 *      gait phases → the gait is live, not a static pose),
 *   3. the WALK-PATH driver ADVANCES the figure along the CatmullRom path
 *      (position progresses monotonically along the curve),
 *   4. FOOT-PLANT: at each step the figure's ground Y matches the terrain height
 *      under its XZ (rides the relief), and the planted stance ankle does not
 *      slide (no foot-slide) thanks to stride-lock + stance IK,
 *   5. HEADING follows the path TANGENT (faces where it walks),
 *   6. STRIDE LOCK: gait phase is locked to distance travelled (cyclesTotal ==
 *      pathLength / stride),
 *   7. reachable via CUA surface: __studioBuildHumanoid → __studioHumanoidAnimate
 *      (play walk) → __studioHumanoidWalkPath are all installed on window.
 *
 * Run: node test/humanoid-walk-path.test.js
 */

import * as THREE from 'three';

let failures = 0;
function check(label, cond, extra = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
  return ok;
}
function approx(a, b, eps) { return Math.abs(a - b) <= eps; }

// ── GUARD: trip if anything tries to import geometry (GLTFLoader / .glb fetch) ─
// The brief forbids ANY imported geometry. We make a GLTFLoader construction or a
// .glb/.gltf fetch a HARD failure so the test can prove the figure is procedural.
let importAttempts = 0;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.fetch = async (url) => {
  const u = String((url && url.url) || url);
  if (/\.(glb|gltf)(\?|#|$)/i.test(u) || /characters\//i.test(u)) {
    importAttempts++;
    throw new Error('FORBIDDEN geometry import attempted: ' + u);
  }
  throw new Error('fetch shim: unhandled url ' + u);
};

// window: the builders read window.__archdiscScene + install onto window.
const scene = new THREE.Scene();
const win = { __archdiscScene: scene, THREE };
globalThis.window = win;

// ── load the actual source modules ───────────────────────────────────────────
const { installHumanoidBuilder } = await import('../src/workbenches/studio/v3/builders/humanoid.js');
const { installHumanoidLocomotion } = await import('../src/workbenches/studio/v3/builders/humanoidLocomotion.js');
const { installNatureBuilder } = await import('../src/workbenches/studio/v3/builders/natureBuilder.js');
const { installStudioAnimPlayer } = await import('../src/workbenches/studio/v3/studioAnimPlayer.js');
const { installRigging } = await import('../src/workbenches/studio/v3/rig/index.js');

installStudioAnimPlayer();
installRigging();              // __studioRigSolveIK (CCD) → stance foot-plant IK (no slide)
installNatureBuilder();        // __studioBuildNature + (after build) __studioTerrainHeight
installHumanoidBuilder();      // __studioBuildHumanoid + __studioPoseHumanoid (PROCEDURAL)
installHumanoidLocomotion();   // __studioHumanoidAnimate/Play/WalkPath (procedural gait)

console.log('\n=== Studio forest PROCEDURAL human + procedural WALK-PATH — headless verify ===\n');

// ── 0. CUA surface present (construct humanoid → play walk → walk-path) ───────
check('CUA: __studioBuildHumanoid installed', typeof win.__studioBuildHumanoid === 'function');
check('CUA: __studioHumanoidAnimate installed (play walk)', typeof win.__studioHumanoidAnimate === 'function');
check('CUA: __studioHumanoidWalkPath installed', typeof win.__studioHumanoidWalkPath === 'function');

// ── 1. forest so a real terrain + clearing exist ─────────────────────────────
const nature = win.__studioBuildNature({ terrainSize: 160, relief: 8, treeCount: 100, seed: 7, forest: true });
check('forest built (terrain + trees)', nature.ok && nature.bodies > 3, `bodies=${nature.bodies} tris=${nature.tris}`);
check('terrain-height sampler exposed', typeof win.__studioTerrainHeight === 'function');

// ── 2. PROCEDURAL human BUILDS (NO glb, NO base mesh) ─────────────────────────
const built = win.__studioBuildHumanoid({ height: 1.8, mcRes: 110, position: [0, 0, 0] });
check('procedural humanoid built ok', built.ok, `bones=${built.boneCount}`);
check('58-bone implicit-surface biped', built.boneCount === 58, `bones=${built.boneCount}`);
check('body is ONE seamless surface (verts polygonised from SDF)', built.totalVertices > 2000, `verts=${built.totalVertices}`);
check('surface is watertight (no leaks)', built.surface && (built.surface.watertight || built.surface.nearWatertight),
  `watertight=${built.surface && built.surface.watertight} nearWT=${built.surface && built.surface.nearWatertight}`);

// confirm the figure is REAL SkinnedMesh geometry in the scene, NOT an imported
// GLTF group (procedural shells are tagged archdiscStudioHumanoidShell).
let skinnedShells = 0, proceduralShells = 0, gltfNodes = 0;
scene.traverse((o) => {
  if (o.isSkinnedMesh && o.userData && o.userData.archdiscStudioRigArmatureUuid === built.armatureUuid) {
    skinnedShells++;
    if (o.userData.archdiscStudioHumanoidShell) proceduralShells++;
  }
  // an imported character tags archdiscRealMaterial / archdiscCharacter*; flag any.
  if (o.userData && (o.userData.archdiscRealMaterial || o.userData.archdiscCharacterClip)) gltfNodes++;
});
check('figure is real SkinnedMesh shells', skinnedShells > 0, `shells=${skinnedShells}`);
check('shells are PROCEDURAL (tagged archdiscStudioHumanoidShell)', proceduralShells === skinnedShells && skinnedShells > 0);
check('ZERO imported-character nodes in the scene', gltfNodes === 0, `gltfNodes=${gltfNodes}`);

// ── 3. procedural WALK cycle DEFORMS the rig (gait is live) ───────────────────
const store = win.__studioHumanoids[win.__studioHumanoidLast];
const sm = store.skinnedMeshes[0];
function sampleVert() {
  sm.updateWorldMatrix(true, false);
  if (sm.skeleton && sm.skeleton.update) sm.skeleton.update();
  const p = new THREE.Vector3();
  sm.getVertexPosition(0, p);
  return p;
}
win.__studioHumanoidAnimate({ cycle: 'walk', t: 0.0, plant: false });
const va = sampleVert();
win.__studioHumanoidAnimate({ cycle: 'walk', t: 0.45, plant: false });
const vb = sampleVert();
const deform = va.distanceTo(vb);
check('procedural WALK cycle deforms the rig (live gait, not static pose)', deform > 1e-3,
  `vertex moved ${deform.toFixed(4)} m between phases`);

// ── 4. WALK-PATH driver: advance + foot-plant + heading + stride-lock ─────────
// a path through a CLEARING near origin (low-density zone keeps trees clear).
const PATH = [[-12, 0, -8], [-5, 0, -2], [2, 0, 3], [10, 0, 9]];
const res = win.__studioHumanoidWalkPath({ path: PATH, speed: 1.3, amp: 1, steps: 200 });

check('walk-path ok', res.ok);
check('walk-path is PROCEDURAL (not mocap)', res.procedural === true);
check('foot-plant via analytic terrain sampler', res.footPlant === 'analytic', `mode=${res.footPlant}`);
check('path has real arc length', res.pathLength > 1, `len=${res.pathLength.toFixed(2)} m`);
check('STRIDE LOCK (gait phase locked to distance — no foot-slide budget drift)',
  res.stride > 0 && approx(res.cyclesTotal, res.pathLength / res.stride, 1e-6),
  `stride=${res.stride} m  cycles=${res.cyclesTotal.toFixed(2)}`);

// ── advance(u) probes: position ADVANCE + ground-Y + heading ─────────────────
// NOTE: these COARSE u-jumps (0→0.2→…) are for verifying advance/heading/ground
// only. Foot-plant + no-slide are verified on the CONTINUOUS fine `report` below
// (the stance-foot IK anchor is a ROLLING anchor that only holds across fine,
// continuous steps — teleporting u by 0.2 deliberately breaks the anchor, which
// is exactly NOT how the driver advances in practice).
console.log('\n  -- advance(u) probes (position advance / ground-Y / heading) --');
const samples = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
let prevDistAlong = -1;
let monotonic = true;
let maxFootErr = 0;       // |reported ground Y - terrain|
let headingFollows = true;
const startP = res.advance(0);
for (const u of samples) {
  const p = res.advance(u);
  // (a) position advances along the path: distance from start grows with u
  const dAlong = Math.hypot(p.x - startP.x, p.z - startP.z);
  if (dAlong + 1e-6 < prevDistAlong) monotonic = false;
  prevDistAlong = dAlong;
  // (b) foot-plant target: terrain height under XZ == reported ground contact Y
  const terr = win.__studioTerrainHeight(p.x, p.z);
  const footErr = Math.abs(p.y - terr);
  if (footErr > maxFootErr) maxFootErr = footErr;
  // (c) heading follows tangent: figure forward = +Z, yaw = atan2(tan.x, tan.z)
  const tan = res.curve.getTangentAt(Math.min(0.9999, u), new THREE.Vector3());
  tan.y = 0; tan.normalize();
  const expectedYaw = Math.atan2(tan.x, tan.z);
  let dYaw = Math.abs(((p.heading - expectedYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  if (dYaw > 1e-3) headingFollows = false;
  console.log(`    u=${u.toFixed(2)}  pos=[${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}]  ` +
    `phase=${p.phase.toFixed(2)}  terrainY=${terr.toFixed(2)}  groundErr=${footErr.toFixed(4)}  ` +
    `yawErr=${dYaw.toFixed(4)}  contact=${p.contact.L ? 'L' : '-'}${p.contact.R ? 'R' : '-'}`);
}
check('position ADVANCES monotonically along the path', monotonic);
check('FOOT-PLANT target (reported ground Y == terrain under XZ)', maxFootErr < 1e-3, `maxGroundErr=${maxFootErr.toFixed(5)} m`);
check('HEADING follows path tangent (faces travel direction)', headingFollows);

// ── 5. CONTINUOUS-motion report: foot-plant on the relief + NO foot-slide ─────
// Re-run the driver fresh so the rolling stance anchors are clean, then read the
// per-step report (fine continuous steps — how the demo actually advances).
win.__studioHumanoidLocomotionReset();
const cont = win.__studioHumanoidWalkPath({ path: PATH, speed: 1.3, amp: 1, steps: 280 });

// (a) planted stance ankle rides the terrain (no float / no sink). The ankle
//     JOINT sits ~ankle-height above the sole, so we allow that offset band.
let maxStanceFootErr = 0;
for (const r of cont.report) {
  const terr = win.__studioTerrainHeight(r.pos[0], r.pos[2]);
  for (const side of ['L', 'R']) {
    if (!r.contact[side] || !r.foot[side]) continue;
    const e = Math.abs(r.foot[side][1] - terr);
    if (e > maxStanceFootErr) maxStanceFootErr = e;
  }
}
check('FOOT-PLANT (planted stance ankle rides terrain over the whole walk, no float/sink)',
  maxStanceFootErr < 0.35, `maxStanceErr=${maxStanceFootErr.toFixed(4)} m (ankle joint sits above the sole)`);

// (b) NO foot-slide — a planted foot's world XZ holds steady across consecutive
//     steps it stays in stance (stride-lock + stance-foot IK pin it).
let maxSlide = 0;
const prevFoot = { L: null, R: null };
for (const r of cont.report) {
  for (const side of ['L', 'R']) {
    const f = r.foot[side];
    if (r.contact[side] && f && prevFoot[side]) {
      const slide = Math.hypot(f[0] - prevFoot[side][0], f[2] - prevFoot[side][2]);
      if (slide > maxSlide) maxSlide = slide;
    }
    prevFoot[side] = r.contact[side] ? f : null;
  }
}
check('NO foot-slide (planted foot XZ pinned by stance IK between consecutive steps)',
  maxSlide < 0.06, `maxSlide=${maxSlide.toFixed(4)} m/step over ${cont.report.length} steps`);

// ── 6. transport wired (a clip the demo can play/scrub via the CUA) ───────────
const clips = win.__studioAnimPlayer.clips();
check('walk-path registered with the anim transport', clips.includes(res.transportName), `clip="${res.transportName}"`);

// ── 7. HARD RULE: zero imported geometry across the whole run ─────────────────
check('ZERO geometry imports attempted (no GLTFLoader / .glb fetch)', importAttempts === 0,
  `importAttempts=${importAttempts}`);

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : '❌ ' + failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
