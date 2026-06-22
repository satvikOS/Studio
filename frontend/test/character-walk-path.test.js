/**
 * HEADLESS verify (no render, no train) — natural organic MOCAP WALK through the
 * forest for the Studio demo. Reference: Video-128 (a natural walking figure —
 * stride, weight-shift, opposed arm-swing).
 *
 * What this proves, using the REAL Soldier.glb Mixamo rig + the REAL builders:
 *   1. the character LOADS (real glTF SkinnedMesh + skeleton + the 'Walk' clip),
 *   2. the WALK clip PLAYS (mixer advances → the rig leaves bind pose, joints
 *      move between phases → genuine mocap gait, not a static T-pose),
 *   3. the PATH DRIVER advances position along the CatmullRom path,
 *   4. FOOT-PLANT: at each sampled t the rig's Y matches the terrain height under
 *      its XZ (rides the relief — no floating / no sinking),
 *   5. HEADING follows the path TANGENT (faces where it walks),
 *   6. STRIDE LOCK: clip cadence is locked to ground speed (no foot-slide),
 *   7. the rig is TAGGED for the path tracer (archdiscStudioPrimitive +
 *      archdiscRealMaterial → bakeSkinnedGeometry harvests it with real PBR).
 *
 * No GPU. We stub the browser seams GLTFLoader needs (self / createImageBitmap /
 * fetch reading the .glb off disk) and a minimal window/document, then drive the
 * actual src/.../realCharacter.js + natureBuilder.js + studioAnimPlayer.js.
 *
 * Run: node test/character-walk-path.test.js
 */

import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CHARS = join(ROOT, 'public/assets/characters');

let failures = 0;
function check(label, cond, extra = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
  return ok;
}
function approx(a, b, eps) { return Math.abs(a - b) <= eps; }

// ── browser seams GLTFLoader + the builders touch (headless stubs) ───────────
globalThis.self = globalThis;
globalThis.createImageBitmap = () => Promise.resolve({ width: 1, height: 1, close() {} });
// rAF: not used by our direct advance() probes, but the transport install may
// reference it. A no-op (we never call play()).
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

// minimal document/location so assetUrl() resolves and modules see a "window".
const FILE_BASE = 'file://' + ROOT.replace(/\\/g, '/') + '/public/';
globalThis.document = { baseURI: FILE_BASE };
globalThis.location = { href: FILE_BASE };

// fetch shim: map any character .glb URL to its bytes on disk, return a Response
// that exposes arrayBuffer() (what three's FileLoader uses for 'arraybuffer').
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String((url && url.url) || url);
  const m = u.match(/assets\/characters\/([^/?#]+)/);
  if (m) {
    const buf = readFileSync(join(CHARS, m[1]));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return {
      ok: true, status: 200, statusText: 'OK',
      headers: { get: () => null },
      arrayBuffer: async () => ab,
      blob: async () => ({ arrayBuffer: async () => ab }),
      json: async () => JSON.parse(Buffer.from(ab).toString('utf8')),
      text: async () => Buffer.from(ab).toString('utf8'),
      body: undefined,   // → FileLoader takes the simple early-return path (no stream reader)
      clone() { return this; },
    };
  }
  if (realFetch) return realFetch(url);
  throw new Error('fetch shim: unhandled url ' + u);
};

// window: the builders read window.__archdiscScene + install onto window.
const scene = new THREE.Scene();
const win = {
  __archdiscScene: scene,
  THREE,
};
globalThis.window = win;

// ── load the actual source modules (after the stubs are in place) ────────────
const { installRealCharacter } = await import('../src/workbenches/studio/v3/builders/realCharacter.js');
const { installNatureBuilder } = await import('../src/workbenches/studio/v3/builders/natureBuilder.js');
const { installStudioAnimPlayer } = await import('../src/workbenches/studio/v3/studioAnimPlayer.js');

installStudioAnimPlayer();   // anim transport (registerClip) first
installNatureBuilder();      // __studioBuildNature + (after build) __studioTerrainHeight
installRealCharacter();      // __studioImportCharacter + __studioCharacterWalkPath

console.log('\n=== Studio forest MOCAP WALK — headless verify (Video-128 natural gait) ===\n');

// ── 1. build the forest so a real terrain + clearing exist ───────────────────
const nature = win.__studioBuildNature({ terrainSize: 160, relief: 8, treeCount: 120, seed: 7 });
check('forest built (terrain + trees)', nature.ok && nature.bodies > 3, `bodies=${nature.bodies} tris=${nature.tris}`);
check('terrain-height sampler exposed', typeof win.__studioTerrainHeight === 'function');
check('walk-path API installed', typeof win.__studioCharacterWalkPath === 'function');

// a path through a CLEARING (low-density zone near origin keeps trees clear).
const PATH = [[-12, 0, -8], [-5, 0, -2], [2, 0, 3], [10, 0, 9]];

// ── 2. drive the walk-path ───────────────────────────────────────────────────
const res = await win.__studioCharacterWalkPath({ asset: 'soldier', clip: 'walk', path: PATH, speed: 1.4 });

check('walk-path ok', res.ok);
check('most-human rig chosen = Soldier', res.asset === 'soldier', `asset=${res.asset}`);
check("real Mixamo WALK clip playing", /walk/i.test(res.clip || ''), `clip=${res.clip}`);
check('foot-plant via analytic terrain sampler', res.footPlant === 'analytic', `mode=${res.footPlant}`);
check('path has real arc length', res.pathLength > 1, `len=${res.pathLength.toFixed(2)} m`);
check('stride-locked cadence (no foot-slide)',
  res.strideMeters > 0 && approx(res.cyclesTotal, res.pathLength / res.strideMeters, 1e-6),
  `stride=${res.strideMeters} m  cycles=${res.cyclesTotal.toFixed(2)}`);

const group = res.group;

// ── 3. rig tagged for the path tracer (skin/cloth real PBR via bakeSkinned) ──
let skinnedTagged = 0, skinnedTotal = 0, realMat = 0;
group.traverse((o) => {
  if (o.isSkinnedMesh) {
    skinnedTotal++;
    if (o.userData.archdiscStudioPrimitive) skinnedTagged++;
    if (o.userData.archdiscRealMaterial && o.material) realMat++;
  }
});
check('rig has SkinnedMesh(es)', skinnedTotal > 0, `count=${skinnedTotal}`);
check('skinned meshes tagged for harvest (archdiscStudioPrimitive)', skinnedTagged === skinnedTotal && skinnedTotal > 0);
check('skinned meshes keep REAL glTF PBR (archdiscRealMaterial)', realMat === skinnedTotal && skinnedTotal > 0);

// ── 4. WALK CLIP actually animates (rig leaves bind pose between phases) ─────
// capture a representative skinned mesh's first deformed vertex at two t's; if
// the gait is live they differ (the clip is genuine mocap motion).
const mixer = group.userData.archdiscCharacterMixer;
function sampleVert() {
  let v = null;
  group.traverse((o) => {
    if (!v && o.isSkinnedMesh) {
      o.updateWorldMatrix(true, false);
      if (o.skeleton && o.skeleton.update) o.skeleton.update();
      const p = new THREE.Vector3();
      o.getVertexPosition(0, p);
      v = p;
    }
  });
  return v;
}
const def = (() => {
  if (!mixer) return null;
  mixer.setTime(0.0);
  group.updateMatrixWorld(true);
  const a = sampleVert();
  // ~half a clip later → a different stride frame
  mixer.setTime(0.45);
  group.updateMatrixWorld(true);
  const b = sampleVert();
  return a && b ? a.distanceTo(b) : 0;
})();
check('WALK clip deforms the rig (mocap gait, not static T-pose)', def != null && def > 1e-4,
  `vertex moved ${def == null ? 'n/a' : def.toFixed(4)} m between frames`);

// ── 5. PATH DRIVER advances + foot-plant + heading along several t's ─────────
console.log('\n  -- advance(u) probes (position / foot-plant / heading) --');
// measure the ACTUAL lowest baked foot vertex in WORLD space (not just the group
// origin) so foot-plant is proven on the real deformed geometry, not the pivot.
function lowestFootWorldY() {
  let minY = Infinity;
  const p = new THREE.Vector3();
  group.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.updateWorldMatrix(true, false);
    if (o.skeleton && o.skeleton.update) o.skeleton.update();
    const geo = o.geometry;
    const cnt = geo.index ? geo.index.count : geo.attributes.position.count;
    const ws = new THREE.Vector3(); o.getWorldScale(ws);
    const needsWorld = Math.abs((Math.abs(ws.x) + Math.abs(ws.y) + Math.abs(ws.z)) / 3 - 1) > 0.02;
    for (let i = 0; i < cnt; i += 17) {   // stride-sample for speed
      const vi = geo.index ? geo.index.getX(i) : i;
      o.getVertexPosition(vi, p);
      if (needsWorld) p.applyMatrix4(o.matrixWorld);
      if (p.y < minY) minY = p.y;
    }
  });
  return minY;
}
const samples = [0, 0.25, 0.5, 0.75, 1.0];
let prevDistAlong = -1;
let monotonic = true;
let maxFootErr = 0;        // |group target Y - terrain|
let maxFootMeshErr = 0;    // |lowest baked foot vertex Y - terrain|
let headingFollows = true;
const startP = res.advance(0);
for (const u of samples) {
  const p = res.advance(u);
  // (a) position advances along the path: distance from start grows with u
  const dAlong = Math.hypot(p.x - startP.x, p.z - startP.z);
  if (dAlong + 1e-6 < prevDistAlong) monotonic = false;
  prevDistAlong = dAlong;
  // (b) foot-plant: terrain height under XZ == reported ground contact Y …
  const terr = win.__studioTerrainHeight(p.x, p.z);
  const footErr = Math.abs(p.y - terr);
  if (footErr > maxFootErr) maxFootErr = footErr;
  // … AND the actual lowest deformed FOOT vertex lands on that terrain Y.
  const footMeshY = lowestFootWorldY();
  const footMeshErr = Math.abs(footMeshY - terr);
  if (footMeshErr > maxFootMeshErr) maxFootMeshErr = footMeshErr;
  // (c) heading follows tangent: model -Z forward, yaw = atan2(tan.x, tan.z)
  const tan = res.curve.getTangentAt(Math.min(0.9999, u), new THREE.Vector3());
  tan.y = 0; tan.normalize();
  const expectedYaw = Math.atan2(tan.x, tan.z);
  // wrap-safe angle delta
  let dYaw = Math.abs(((p.heading - expectedYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  if (dYaw > 1e-3) headingFollows = false;
  console.log(`    u=${u.toFixed(2)}  pos=[${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}]  ` +
    `terrainY=${terr.toFixed(2)}  footMeshY=${footMeshY.toFixed(2)}  footErr=${footMeshErr.toFixed(3)}  yawErr=${dYaw.toFixed(4)}`);
}
check('position ADVANCES monotonically along the path', monotonic);
check('FOOT-PLANT (group target == terrain)', maxFootErr < 1e-3, `maxFootErr=${maxFootErr.toFixed(5)} m`);
check('FOOT-PLANT (actual deformed foot vertex rides terrain, no float/sink)',
  maxFootMeshErr < 0.12, `maxFootMeshErr=${maxFootMeshErr.toFixed(4)} m (heel/toe lift within a stride)`);
check('HEADING follows path tangent (faces travel direction)', headingFollows);

// ── 6. transport wired (a clip the demo can play/scrub) ──────────────────────
const clips = win.__studioAnimPlayer.clips();
check('walk-path registered with the anim transport', clips.includes(res.transportName), `clip="${res.transportName}"`);

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : '❌ ' + failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
