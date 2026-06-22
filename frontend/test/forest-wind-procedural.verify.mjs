/**
 * HEADLESS verify (no render, no train) — PROCEDURAL wind-blown FOREST.
 *
 * Proves, against the REAL src natureBuilder.js (no mocks of the builder):
 *   1. construct{subject:'nature'} reaches a real FOREST (forest:true by default),
 *   2. the forest is ENTIRELY procedural — terrain + trees + scatter + water are
 *      generated geometry; NO glb/gltf/fbx/obj geometry is ever loaded (we trap
 *      every network/file fetch and assert no mesh-asset URL is requested),
 *   3. the canopy is layered + dense (multiple bark/foliage species meshes, a real
 *      tree count, a walkable path + clearing, ground scatter rocks/grass/ferns),
 *   4. materials are TAGGED (bark/foliage/grass/rock/dirt/water) for real PBR,
 *   5. the golden-hour SKY HDRI is requested (real HDR, allowed — it is lighting,
 *      not geometry) and the file is shipped to public/assets/hdri/,
 *   6. window.__studioForestWind(t,{dir,strength}) SWAYS the canopy/grass/fern
 *      vertices in a CONSISTENT direction with gusts, amplitude growing with height,
 *      and the displacement EVOLVES over t (different t ⇒ different vertices).
 *
 * No GPU, no render. Run: node test/forest-wind-procedural.verify.mjs
 */

import * as THREE from 'three';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let failures = 0;
function check(label, cond, extra = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
  return ok;
}

// ── trap EVERY fetch/file load so we can prove NO geometry asset is imported. The
//    only network/file load the forest is allowed is the .hdr sky (lighting). The
//    HDRI load resolves to a status object; in headless THREE.PMREMGenerator needs
//    a renderer (absent) so we just record the URL and fail it gracefully.
const fetchedUrls = [];
const FILE_BASE = 'file://' + ROOT.replace(/\\/g, '/') + '/public/';
globalThis.self = globalThis;
globalThis.createImageBitmap = () => Promise.resolve({ width: 1, height: 1, close() {} });
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.document = { baseURI: FILE_BASE };
globalThis.location = { href: FILE_BASE };
globalThis.fetch = async (url) => {
  const u = String((url && url.url) || url);
  fetchedUrls.push(u);
  // never actually serve bytes — we only want to know WHAT was requested.
  throw new Error('headless: fetch trapped (' + u + ')');
};
// three's RGBELoader uses XMLHttpRequest via FileLoader in some builds; trap it too.
class FakeXHR {
  open(_m, url) { this._url = url; fetchedUrls.push(String(url)); }
  setRequestHeader() {}
  addEventListener(ev, cb) { if (ev === 'error') this._err = cb; }
  send() { if (this._err) this._err({ message: 'headless: XHR trapped' }); if (this.onerror) this.onerror({ message: 'headless: XHR trapped' }); }
  abort() {}
}
globalThis.XMLHttpRequest = FakeXHR;

const scene = new THREE.Scene();
const win = { __archdiscScene: scene, THREE };
globalThis.window = win;

// ── load + install the REAL builder ──────────────────────────────────────────
const { installNatureBuilder } = await import('../src/workbenches/studio/v3/builders/natureBuilder.js');
const inst = installNatureBuilder();

console.log('\n=== PROCEDURAL wind-blown FOREST — headless verify (no imports, wind over t) ===\n');

check('installNatureBuilder ok', inst && inst.ok);
check('__studioBuildNature installed', typeof win.__studioBuildNature === 'function');
check('__studioForestWind installed', typeof win.__studioForestWind === 'function');
check('__studioNatureAnimate installed', typeof win.__studioNatureAnimate === 'function');
check('__studioSetForestWind installed', typeof win.__studioSetForestWind === 'function');
check('__studioForestHDRI installed', typeof win.__studioForestHDRI === 'function');

// ── 1. build the FOREST (forest:true → the path/clearing, layered canopy, HDRI,
//    wind). Deterministic seed. This is exactly what construct{subject:'nature'}
//    now reaches by default (STUDIO_CONSTRUCT_DEFAULTS.nature = {forest:true}).
const nat = win.__studioBuildNature({
  forest: true,
  terrainSize: 140, relief: 6, treeCount: 420,
  species: ['conifer', 'broadleaf', 'birch', 'shrub'],
  season: 'summer', seed: 653, fog: true,
  path: true, wind: { dir: [0.82, 0.57], strength: 1.15 }, hdri: 'golden',
});

console.log(`  nature → ok=${nat.ok} forest=${nat.forest} bodies=${nat.bodies} tris=${nat.tris} trees=${nat.treeCount} species=${JSON.stringify(nat.species)}`);
console.log(`  path=${JSON.stringify(nat.path)} fog=${nat.fog} hdri=${JSON.stringify(nat.hdri)} wind=${JSON.stringify(nat.wind)}`);

check('forest built ok', nat.ok === true);
check('forest mode engaged', nat.forest === true);
check('frame-dominating tree count', nat.treeCount > 200, `trees=${nat.treeCount}`);
check('layered multi-mesh canopy (bark+foliage per species + scatter)', nat.bodies >= 8, `bodies=${nat.bodies}`);
check('real geometry (tris)', nat.tris > 50000, `tris=${nat.tris}`);
check('walkable path + clearing carved', nat.path && nat.path.enabled === true && nat.path.clearing && nat.path.clearing.r > 0, JSON.stringify(nat.path));
check('depth-haze fog applied', nat.fog === true);
check('golden-hour HDRI requested', nat.hdri && nat.hdri.preset === 'golden' && /golden/.test(String(nat.hdri.file)));
check('directional wind field active', Array.isArray(nat.wind.dir) && nat.wind.strength > 0);
check('walk-path centreline exposed', win.__studioForestPath && typeof win.__studioForestPath.pathAt === 'function');

// ── 2. PROVE no geometry asset was imported. Allowed: the .hdr sky (lighting).
const geomLoads = fetchedUrls.filter((u) => /\.(glb|gltf|fbx|obj|dae|stl|ply|3ds|bin)(\?|$)/i.test(u));
const hdrLoads  = fetchedUrls.filter((u) => /\.hdr(\?|$)/i.test(u));
console.log(`  fetched URLs: ${fetchedUrls.length} — geometry=${geomLoads.length} hdr=${hdrLoads.length}`);
if (fetchedUrls.length) console.log('  urls: ' + fetchedUrls.map((u) => u.replace(FILE_BASE, '')).join(', '));
check('ZERO geometry imports (no glb/gltf/fbx/obj/...)', geomLoads.length === 0, geomLoads.join(', '));
check('only the .hdr sky was requested (lighting, allowed)', hdrLoads.length >= 1, hdrLoads.map((u) => u.replace(FILE_BASE, '')).join(', '));
// the shipped HDRI file actually exists on disk.
const skyFile = join(ROOT, 'public/assets/hdri/sky-golden.hdr');
check('golden-hour sky HDRI shipped on disk', existsSync(skyFile) && statSync(skyFile).size > 100000, existsSync(skyFile) ? `${Math.round(statSync(skyFile).size / 1024)}KB` : 'MISSING');

// ── 3. inspect the live scene: every nature mesh is procedural (BufferGeometry,
//    no glTF provenance) + carries a material tag from the PBR palette.
const TAGS = new Set(['bark', 'foliage', 'grass', 'rock', 'water', 'dirt']);
const seenTags = new Set();
let natureMeshes = 0, taggedMeshes = 0, procGeo = 0, nonProc = 0;
scene.traverse((o) => {
  if (!(o.isMesh && o.userData && o.userData.archdiscStudioNature)) return;
  natureMeshes++;
  const tag = o.userData.studioMaterial;
  if (TAGS.has(tag)) { taggedMeshes++; seenTags.add(tag); }
  if (o.userData.archdiscStudioPrimitive) procGeo++;            // tagged as a built primitive
  // a glTF-imported mesh would carry name/userData from the loader; ours are bare
  // procedural geos with our own tags only.
  if (o.userData.gltfExtensions || o.userData.__glb || o.userData.archdiscRealMaterial) nonProc++;
});
console.log(`  scene nature meshes=${natureMeshes} tagged=${taggedMeshes} tags={${[...seenTags].join(',')}}`);
check('all nature meshes tagged archdiscStudioPrimitive (procedural)', procGeo === natureMeshes && natureMeshes > 0, `${procGeo}/${natureMeshes}`);
check('NO imported-asset meshes in the forest', nonProc === 0);
check('material palette tags present (bark/foliage/grass/rock/dirt/water)',
  ['bark', 'foliage', 'grass', 'rock'].every((t) => seenTags.has(t)), `{${[...seenTags].join(',')}}`);

// ── 4. WIND: capture a foliage mesh's rest XZ, drive the wind at t=0 vs t=2.0,
//    and prove (a) vertices MOVE, (b) the motion EVOLVES over t, (c) it follows
//    the wind direction, (d) amplitude grows with height (tops move more than base).
function foliageMesh() {
  let m = null;
  scene.traverse((o) => { if (!m && o.isMesh && o.userData && o.userData.archdiscStudioNature && o.userData.studioMaterial === 'foliage') m = o; });
  return m;
}
const fol = foliageMesh();
check('a foliage canopy mesh exists', !!fol);

if (fol) {
  const pos = fol.geometry.attributes.position;
  // rest snapshot (the animate hook caches its own __swayBase from the first call;
  // we snapshot the CURRENT positions which equal rest before any animate call).
  const rest = new Float32Array(pos.count * 3);
  for (let v = 0; v < pos.count; v++) { rest[v * 3] = pos.getX(v); rest[v * 3 + 1] = pos.getY(v); rest[v * 3 + 2] = pos.getZ(v); }

  // set a known wind direction + drive t = 0.0
  const r0 = win.__studioForestWind(0.0, { dir: [1, 0], strength: 1.2 });
  const at0 = new Float32Array(pos.count * 3);
  for (let v = 0; v < pos.count; v++) { at0[v * 3] = pos.getX(v); at0[v * 3 + 1] = pos.getY(v); at0[v * 3 + 2] = pos.getZ(v); }

  // drive t = 2.0 (same direction) — a gust front has marched, vertices shift.
  const r2 = win.__studioForestWind(2.0, { dir: [1, 0], strength: 1.2 });
  const at2 = new Float32Array(pos.count * 3);
  for (let v = 0; v < pos.count; v++) { at2[v * 3] = pos.getX(v); at2[v * 3 + 1] = pos.getY(v); at2[v * 3 + 2] = pos.getZ(v); }

  check('__studioForestWind returns active wind', r0 && r0.ok && r2 && r2.ok && Array.isArray(r2.dir));

  // (a) wind at t=0 already displaces canopy vertices off rest.
  let moved0 = 0, maxOff0 = 0;
  for (let v = 0; v < pos.count; v++) {
    const dx = at0[v * 3] - rest[v * 3], dz = at0[v * 3 + 2] - rest[v * 3 + 2];
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) moved0++;
    if (d > maxOff0) maxOff0 = d;
  }
  check('wind displaces canopy vertices at t=0', moved0 > pos.count * 0.5 && maxOff0 > 0.01, `moved=${moved0}/${pos.count} maxOff=${maxOff0.toFixed(3)}`);

  // (b) the displacement EVOLVES over t — t=2 differs meaningfully from t=0.
  let changed = 0, maxDelta = 0;
  for (let v = 0; v < pos.count; v++) {
    const dx = at2[v * 3] - at0[v * 3], dz = at2[v * 3 + 2] - at0[v * 3 + 2];
    const d = Math.hypot(dx, dz);
    if (d > 1e-3) changed++;
    if (d > maxDelta) maxDelta = d;
  }
  check('wind sway EVOLVES over t (t=2 ≠ t=0)', changed > pos.count * 0.4 && maxDelta > 0.01, `changed=${changed}/${pos.count} maxDelta=${maxDelta.toFixed(3)}`);

  // (c) DIRECTIONAL — net sway is along the wind (+X here), |X offset| dominates |Z|.
  let sumAbsX = 0, sumAbsZ = 0;
  for (let v = 0; v < pos.count; v++) {
    sumAbsX += Math.abs(at2[v * 3] - rest[v * 3]);
    sumAbsZ += Math.abs(at2[v * 3 + 2] - rest[v * 3 + 2]);
  }
  check('sway is DIRECTIONAL (along wind +X)', sumAbsX > sumAbsZ * 3, `Σ|X|=${sumAbsX.toFixed(2)} Σ|Z|=${sumAbsZ.toFixed(2)}`);

  // (d) amplitude grows with height: top-third verts move more than bottom-third.
  fol.geometry.computeBoundingBox();
  const minY = fol.geometry.boundingBox.min.y, maxY = fol.geometry.boundingBox.max.y;
  const span = maxY - minY || 1;
  let lowSum = 0, lowN = 0, highSum = 0, highN = 0;
  for (let v = 0; v < pos.count; v++) {
    const y = rest[v * 3 + 1];
    const f = (y - minY) / span;
    const off = Math.hypot(at2[v * 3] - rest[v * 3], at2[v * 3 + 2] - rest[v * 3 + 2]);
    if (f < 0.33) { lowSum += off; lowN++; }
    else if (f > 0.66) { highSum += off; highN++; }
  }
  const lowAvg = lowN ? lowSum / lowN : 0, highAvg = highN ? highSum / highN : 0;
  check('amplitude grows with height (tops sway > base)', highAvg > lowAvg * 1.5, `low=${lowAvg.toFixed(3)} high=${highAvg.toFixed(3)}`);

  // (e) grass + bark also respond (whole forest sways, not just canopy).
  let grassMoved = false, barkMoved = false;
  scene.traverse((o) => {
    if (!(o.isMesh && o.userData && o.userData.archdiscStudioNature)) return;
    if (o.userData.studioMaterial === 'grass' || o.userData.studioMaterial === 'bark') {
      const p = o.geometry.attributes.position, base = o.userData.__swayBase;
      if (!base) return;
      let mv = false;
      for (let v = 0; v < p.count; v++) {
        if (Math.hypot(p.getX(v) - base[v * 3], p.getZ(v) - base[v * 3 + 2]) > 1e-4) { mv = true; break; }
      }
      if (o.userData.studioMaterial === 'grass' && mv) grassMoved = true;
      if (o.userData.studioMaterial === 'bark' && mv) barkMoved = true;
    }
  });
  check('grass blades sway in the wind', grassMoved);
  check('tree trunks (bark) lean in the wind', barkMoved);
}

// ── 5. determinism — same seed ⇒ same tree count + tris (procedural + seeded).
const nat2 = win.__studioBuildNature({ forest: true, terrainSize: 140, relief: 6, treeCount: 420, species: ['conifer', 'broadleaf', 'birch', 'shrub'], season: 'summer', seed: 653, fog: true, path: true, wind: { dir: [0.82, 0.57], strength: 1.15 }, hdri: 'golden' });
check('deterministic rebuild (same seed ⇒ same trees + tris)', nat2.treeCount === nat.treeCount && nat2.tris === nat.tris, `trees ${nat.treeCount}=${nat2.treeCount}, tris ${nat.tris}=${nat2.tris}`);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
