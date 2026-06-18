// Studio scene composer — parametric furniture LIBRARY + room layouts.
//
// The asset-library pattern (same one that makes Forge's parts production-
// grade): Archie plans the scene (layout intent); this library REALIZES
// detailed, asymmetric, materialed geometry — recognizable furniture built
// from soft rounded-edge parts (a sofa = base + back + two arms + seat/back
// cushions, a chair = seat + back + four legs), placed with real spacing +
// per-instance jitter so nothing is a stack of identical cubes. Each part is
// a THREE mesh tagged userData.archdiscStudioPrimitive (so the demo counts it
// + the path tracer harvests it) + userData.studioMaterial (a materialRegistry
// id, so the path tracer shades it photorealistically).
//
// Fully local: pure THREE geometry, no assets, no network. composeScene(id)
// clears the scene and builds a named layout; window.__studioComposeScene.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { MATERIALS } from '../materialRegistry.js';

// Deterministic RNG so renders are reproducible but geometry is asymmetric.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function matFor(id) {
  const m = MATERIALS[id] || MATERIALS['plastic-matte'];
  return new THREE.MeshStandardMaterial({
    color: m.color, metalness: m.metalness ?? 0.0, roughness: m.roughness ?? 0.6,
  });
}

// A part: rounded box (soft edges → not CG-sharp), cylinder, or sphere.
function box(w, h, d, mat) {
  const r = Math.min(w, h, d) * 0.08;
  const g = new RoundedBoxGeometry(w, h, d, 3, Math.max(r, 0.004));
  const m = new THREE.Mesh(g, matFor(mat));
  m.userData.studioMaterial = mat;
  return m;
}
function cyl(rt, rb, h, mat, seg = 28) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), matFor(mat));
  m.userData.studioMaterial = mat;
  return m;
}
function ball(r, mat) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), matFor(mat));
  m.userData.studioMaterial = mat;
  return m;
}
function place(mesh, x, y, z, ry = 0) { mesh.position.set(x, y, z); mesh.rotation.y = ry; return mesh; }

// ───────────────────────── furniture builders (→ THREE.Group) ──────────────
// Each returns a Group whose children are detailed parts. Materials chosen
// per part for realism (frame wood, cushions fabric, legs metal, etc.).

function sofa(rng, { w = 2.1, d = 0.95, seatH = 0.42, fabric = 'fabric-grey', frame = 'wood-walnut' } = {}) {
  const g = new THREE.Group(); const arm = 0.18, back = 0.62, cush = 0.16;
  g.add(place(box(w, seatH, d, frame), 0, seatH / 2, 0));                                   // base
  g.add(place(box(w, back, 0.22, fabric), 0, seatH + back / 2, -d / 2 + 0.11));             // backrest
  g.add(place(box(arm, back * 0.7, d, frame), -w / 2 + arm / 2, seatH + back * 0.35 - 0.05, 0)); // arm L
  g.add(place(box(arm, back * 0.7, d, frame), w / 2 - arm / 2, seatH + back * 0.35 - 0.05, 0));  // arm R
  const seats = Math.max(2, Math.round(w / 0.9));
  const sw = (w - 2 * arm - 0.06) / seats;
  for (let i = 0; i < seats; i++) {
    const cx = -w / 2 + arm + 0.03 + sw * (i + 0.5);
    g.add(place(box(sw - 0.04, cush, d - 0.16, fabric), cx, seatH + cush / 2 + 0.01, 0.04));   // seat cushion
    const bc = place(box(sw - 0.05, back * 0.74, cush, fabric), cx, seatH + back * 0.42, -d / 2 + 0.20);
    bc.rotation.x = -0.06 + (rng() - 0.5) * 0.04;                                              // back cushion, slight lean
    g.add(bc);
  }
  return g;
}

function armchair(rng, { fabric = 'leather-tan', frame = 'wood-walnut' } = {}) {
  return sofa(rng, { w: 0.92, d: 0.9, fabric, frame });
}

function coffeeTable(rng, { w = 1.2, d = 0.6, h = 0.42, top = 'wood-oak', leg = 'steel-brushed' } = {}) {
  const g = new THREE.Group(); const t = 0.05, lt = 0.04;
  g.add(place(box(w, t, d, top), 0, h, 0));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    g.add(place(cyl(lt, lt, h, leg), sx * (w / 2 - 0.08), h / 2, sz * (d / 2 - 0.08)));
  return g;
}

function diningTable(rng, { w = 1.6, d = 0.9, h = 0.74, top = 'wood-walnut', leg = 'wood-walnut' } = {}) {
  const g = new THREE.Group(); const t = 0.06, lt = 0.07;
  g.add(place(box(w, t, d, top), 0, h, 0));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    g.add(place(box(lt, h, lt, leg), sx * (w / 2 - 0.1), h / 2, sz * (d / 2 - 0.1)));
  return g;
}

function chair(rng, { seatH = 0.46, w = 0.46, d = 0.46, seatMat = 'fabric-linen', frame = 'wood-oak' } = {}) {
  const g = new THREE.Group(); const t = 0.05, lt = 0.035, bh = 0.5;
  g.add(place(box(w, t, d, seatMat), 0, seatH, 0));
  g.add(place(box(w, bh, 0.05, seatMat), 0, seatH + bh / 2, -d / 2 + 0.03));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    g.add(place(cyl(lt, lt, seatH, frame), sx * (w / 2 - lt), seatH / 2, sz * (d / 2 - lt)));
  return g;
}

function bed(rng, { w = 1.6, d = 2.05, frameH = 0.3, frame = 'wood-walnut', sheet = 'fabric-linen' } = {}) {
  const g = new THREE.Group();
  g.add(place(box(w, frameH, d, frame), 0, frameH / 2, 0));                                  // platform
  g.add(place(box(w - 0.08, 0.18, d - 0.1, sheet), 0, frameH + 0.09, 0.02));                 // mattress
  g.add(place(box(w, 0.7, 0.08, frame), 0, frameH + 0.35, -d / 2 + 0.04));                   // headboard
  for (const sx of [-1, 1]) {                                                                // pillows
    const p = place(box(0.5, 0.12, 0.32, 'fabric-grey'), sx * 0.42, frameH + 0.24, -d / 2 + 0.28);
    p.rotation.z = (rng() - 0.5) * 0.08; g.add(p);
  }
  const duvet = place(box(w - 0.06, 0.1, d * 0.6, 'fabric-grey'), 0, frameH + 0.2, d * 0.16);
  g.add(duvet);
  return g;
}

function nightstand(rng, { mat = 'wood-walnut' } = {}) {
  const g = new THREE.Group();
  g.add(place(box(0.45, 0.5, 0.4, mat), 0, 0.25, 0));
  g.add(place(box(0.42, 0.04, 0.38, mat), 0, 0.5, 0));
  return g;
}

function floorLamp(rng, { h = 1.55, base = 'steel-brushed', shade = 'ceramic-white' } = {}) {
  const g = new THREE.Group();
  g.add(place(cyl(0.16, 0.18, 0.04, base), 0, 0.02, 0));
  g.add(place(cyl(0.018, 0.018, h, base), 0, h / 2, 0));
  g.add(place(cyl(0.2, 0.26, 0.28, shade), 0, h, 0));
  return g;
}

function rug(rng, { w = 2.6, d = 1.8, mat = 'fabric-grey' } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), matFor(mat));
  m.userData.studioMaterial = mat; return place(m, 0, 0.011, 0);
}

function bookshelf(rng, { w = 1.0, h = 1.9, d = 0.32, mat = 'wood-oak' } = {}) {
  const g = new THREE.Group(); const t = 0.04, shelves = 5;
  g.add(place(box(t, h, d, mat), -w / 2, h / 2, 0));
  g.add(place(box(t, h, d, mat), w / 2, h / 2, 0));
  for (let i = 0; i < shelves; i++) g.add(place(box(w, t, d, mat), 0, (i / (shelves - 1)) * (h - t) + t / 2, 0));
  // a few books, varied
  for (let i = 0; i < 10; i++) {
    const sh = Math.floor(rng() * (shelves - 1));
    const bw = 0.04 + rng() * 0.03, bh = 0.18 + rng() * 0.08;
    const mats = ['leather-tan', 'fabric-linen', 'plastic-matte', 'wood-walnut'];
    g.add(place(box(bw, bh, d - 0.06, mats[i % mats.length]), -w / 2 + 0.1 + i * 0.08, (sh / (shelves - 1)) * (h - t) + t + bh / 2, 0));
  }
  return g;
}

function plant(rng, { h = 1.1 } = {}) {
  const g = new THREE.Group();
  g.add(place(cyl(0.16, 0.13, 0.3, 'ceramic-white'), 0, 0.15, 0));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, lr = 0.06 + rng() * 0.05;
    const leaf = place(box(lr, 0.5 + rng() * 0.3, 0.02, 'rubber-black'), Math.cos(a) * 0.1, 0.3 + (0.4 + rng() * 0.3), Math.sin(a) * 0.1, a);
    leaf.rotation.z = (rng() - 0.5) * 0.5; g.add(leaf);
  }
  return g;
}

function pedestal(rng, { mat = 'marble-white', h = 0.95 } = {}) {
  const g = new THREE.Group();
  g.add(place(box(0.5, 0.06, 0.5, mat), 0, 0.03, 0));
  g.add(place(box(0.38, h - 0.1, 0.38, mat), 0, h / 2, 0));
  g.add(place(box(0.5, 0.06, 0.5, mat), 0, h, 0));
  return g;
}

function productHero(rng) {
  // an abstract but designed hero object: a tapered vase form.
  const g = new THREE.Group();
  g.add(place(cyl(0.07, 0.12, 0.26, 'gold-polished'), 0, 0.13, 0));
  g.add(place(cyl(0.12, 0.07, 0.22, 'gold-polished'), 0, 0.37, 0));
  g.add(place(ball(0.09, 'gold-polished'), 0, 0.52, 0));
  return g;
}

function backdrop(rng, { w = 4, h = 2.4, mat = 'plastic-matte' } = {}) {
  // a smooth cyclorama-ish backdrop: floor sweep + wall, soft-cornered.
  const g = new THREE.Group();
  const wall = place(box(w, h, 0.05, mat), 0, h / 2, -1.4);
  g.add(wall);
  return g;
}

function counter(rng, { w = 2.2, h = 1.05, d = 0.65, body = 'wood-walnut', top = 'marble-white' } = {}) {
  const g = new THREE.Group();
  g.add(place(box(w, h, d, body), 0, h / 2, 0));
  g.add(place(box(w + 0.08, 0.05, d + 0.06, top), 0, h + 0.02, 0));
  return g;
}

function pendant(rng, { y = 2.1, shade = 'brass' } = {}) {
  const g = new THREE.Group();
  g.add(place(cyl(0.004, 0.004, 1.2, 'steel-brushed'), 0, y + 0.6, 0));
  g.add(place(cyl(0.14, 0.18, 0.18, shade), 0, y, 0));
  return g;
}

// ───────────────────────── layouts (place builders) ───────────────────────
// Each layout positions builders with real spacing + facing + jitter.

function addJittered(scene, group, x, z, ry, rng, posJit = 0.04, rotJit = 0.05) {
  group.position.x += x + (rng() - 0.5) * posJit;
  group.position.z += z + (rng() - 0.5) * posJit;
  group.rotation.y += ry + (rng() - 0.5) * rotJit;
  group.updateMatrixWorld(true);
  // Collect THEN add — reparenting during traverse() mutates the children
  // array mid-iteration and skips siblings. Bake the world transform into
  // each geometry so parts land correctly once detached from the group.
  const meshes = [];
  group.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    o.updateWorldMatrix(true, false);
    o.geometry.applyMatrix4(o.matrixWorld);
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.matrix.identity();
    o.userData.archdiscStudioPrimitive = true;
    o.castShadow = true; o.receiveShadow = true;
    scene.add(o);
  }
}

// Extended furniture builders (workflow-designed) — use box/cyl/ball/place.
const XF = {
  desk: function(rng, p={}) { const g = new THREE.Group(); const topW = p.width || 1.2, topD = p.depth || 0.6, topH = p.thickness || 0.04; const legH = p.legHeight || 0.75, legW = 0.05, legD = 0.05; const kneeholeW = 0.4, kneeholeH = 0.2; const top = box(topW, topH, topD, 'wood-oak'); place(top, 0, legH, 0, 0); g.add(top); const legPosX = [-(topW/2 - 0.1), (topW/2 - 0.1)]; const legPosZ = [-(topD/2 - 0.1), (topD/2 - 0.1)]; for(let i = 0; i < legPosX.length; i++) { for(let j = 0; j < legPosZ.length; j++) { if(!(i === 1 && j === 0 && rng() < 0.3)) { const leg = box(legW, legH, legD, 'wood-walnut'); place(leg, legPosX[i], legH/2, legPosZ[j], 0); g.add(leg); } } } const drawerY = legH + topH + 0.15; for(let d = 0; d < 2; d++) { const drawerFront = box(0.35, 0.08, 0.04, 'wood-oak'); const offset = (d - 0.5) * 0.4; place(drawerFront, offset, drawerY + d * 0.12, topD/2 - 0.05, 0); g.add(drawerFront); const handle = cyl(0.006, 0.006, 0.08, 'brass', 6); place(handle, offset + 0.1, drawerY + d * 0.12, topD/2 + 0.01, Math.PI/2); g.add(handle); } return g; },
  officeChair: function(rng, p={}) { const g = new THREE.Group(); const seatW = p.seatWidth || 0.5, seatD = 0.5, seatH = 0.04; const backH = p.backHeight || 0.6, backW = 0.45; const baseR = p.baseRadius || 0.35; const seat = box(seatW, seatH, seatD, 'fabric-grey'); place(seat, 0, 0.42, 0, 0); g.add(seat); const backRest = box(backW, backH, 0.05, 'fabric-linen'); place(backRest, 0, 0.62, -0.15, rng() * 0.1 - 0.05); g.add(backRest); const base = cyl(baseR, baseR, 0.02, 'plastic-matte', 5); place(base, 0, 0.02, 0, 0); g.add(base); for(let c = 0; c < 5; c++) { const angle = (c / 5) * Math.PI * 2 + rng() * 0.2; const casterDist = baseR - 0.05; const castX = Math.cos(angle) * casterDist; const castZ = Math.sin(angle) * casterDist; const caster = ball(0.015, 'rubber-black'); place(caster, castX, 0.015, castZ, 0); g.add(caster); } const pipeH = 0.35; const centerPipe = cyl(0.015, 0.015, pipeH, 'steel-brushed', 8); place(centerPipe, 0, 0.02 + pipeH/2, 0, 0); g.add(centerPipe); const armL = box(0.3, 0.05, 0.08, 'plastic-matte'); place(armL, -0.35, 0.5, 0, rng() * 0.15); g.add(armL); const armR = box(0.3, 0.05, 0.08, 'plastic-matte'); place(armR, 0.35, 0.5, 0, -rng() * 0.15); g.add(armR); return g; },
  wardrobe: function(rng, p={}) { const g = new THREE.Group(); const w = p.width || 0.9, h = p.height || 2.1, d = p.depth || 0.6; const boxThick = 0.02; const body = box(w, h, d, 'wood-oak'); place(body, 0, h/2, 0, 0); g.add(body); const doorW = (w / 2) - 0.01, doorH = h - 0.05; const doorL = box(doorW, doorH, 0.04, 'wood-walnut'); place(doorL, -(w/4 - 0.005), h/2, d/2 + 0.02, rng() * 0.05 - 0.025); g.add(doorL); const doorR = box(doorW, doorH, 0.04, 'wood-walnut'); place(doorR, (w/4 + 0.005), h/2, d/2 + 0.02, -rng() * 0.05 + 0.025); g.add(doorR); for(let d_idx = 0; d_idx < 2; d_idx++) { const handleY = h - 0.3 - d_idx * 0.8; const handleL = cyl(0.008, 0.008, 0.15, 'brass', 6); place(handleL, -(w/4), handleY, d/2 + 0.06, Math.PI/2); g.add(handleL); const handleR = cyl(0.008, 0.008, 0.15, 'brass', 6); place(handleR, (w/4), handleY, d/2 + 0.06, Math.PI/2); g.add(handleR); } const shelfMid = box(w - 0.04, 0.015, d - 0.02, 'wood-walnut'); place(shelfMid, 0, h/2, 0, 0); g.add(shelfMid); for(let i = 0; i < 3; i++) { const shelfY = h * (0.3 + i * 0.25); const shelf = box(w - 0.04, 0.012, d - 0.02, 'wood-oak'); place(shelf, 0, shelfY, 0, rng() * 0.02); g.add(shelf); } const topCrown = box(w + 0.05, 0.05, d + 0.02, 'wood-walnut'); place(topCrown, 0, h + 0.025, 0, 0); g.add(topCrown); return g; },
  dresser: function(rng, p={}) { const g = new THREE.Group(); const w = p.width || 1.0, h = p.height || 0.9, d = p.depth || 0.5; const topThick = 0.04, legH = 0.08; const body = box(w - 0.04, h - topThick - legH, d - 0.04, 'wood-oak'); place(body, 0, (h - topThick - legH) / 2 + legH, 0, 0); g.add(body); const drawerCount = p.drawers || 4; const drawerH = (h - topThick - legH - 0.02) / drawerCount; for(let dr = 0; dr < drawerCount; dr++) { const drawerY = legH + (dr + 0.5) * drawerH; const frontW = w - 0.08; const drawerFront = box(frontW, drawerH - 0.008, 0.05, 'wood-walnut'); place(drawerFront, 0, drawerY, d/2, 0); g.add(drawerFront); const handleL = cyl(0.006, 0.006, 0.1, 'brass', 5); place(handleL, -frontW/4, drawerY, d/2 + 0.03, Math.PI/2); g.add(handleL); const handleR = cyl(0.006, 0.006, 0.1, 'brass', 5); place(handleR, frontW/4, drawerY, d/2 + 0.03, Math.PI/2); g.add(handleR); } const top = box(w, topThick, d, 'wood-walnut'); place(top, 0, h - topThick/2, 0, rng() * 0.05 - 0.025); g.add(top); for(let leg = 0; leg < 4; leg++) { const lx = ((leg % 2) - 0.5) * (w - 0.1); const lz = (Math.floor(leg/2) - 0.5) * (d - 0.08); const legGeom = box(0.04, legH, 0.04, 'wood-oak'); place(legGeom, lx, legH/2, lz, 0); g.add(legGeom); } return g; },
  diningTableLong: function(rng, p={}) { const g = new THREE.Group(); const tblW = p.width || 1.0, tblL = p.length || 2.4, tblH = p.height || 0.75; const topThick = 0.05; const top = box(tblW, topThick, tblL, 'wood-oak'); place(top, 0, tblH, 0, rng() * 0.08 - 0.04); g.add(top); const pedestal = cyl(0.15, 0.15, tblH - topThick, 'wood-walnut', 8); place(pedestal, 0, (tblH - topThick) / 2, 0, 0); g.add(pedestal); const baseW = 0.45; const baseDepth = 0.08; const crossbrace1 = box(baseW * 1.8, baseDepth, baseDepth, 'wood-walnut'); place(crossbrace1, 0, 0.08, 0, 0); g.add(crossbrace1); const crossbrace2 = box(baseDepth, baseDepth, baseW * 1.5, 'wood-walnut'); place(crossbrace2, 0, 0.08, 0, 0); g.add(crossbrace2); const foot = box(baseW, 0.06, baseW, 'wood-oak'); place(foot, 0, 0.03, 0, 0); g.add(foot); for(let e = 0; e < 3; e++) { const edgeL = box(tblL - 0.08, 0.015, 0.015, 'wood-walnut'); place(edgeL, -(tblW/2 - 0.05), tblH + 0.025, -tblL/4 + e * (tblL/3), rng() * 0.1); g.add(edgeL); const edgeR = box(tblL - 0.08, 0.015, 0.015, 'wood-walnut'); place(edgeR, (tblW/2 - 0.05), tblH + 0.025, -tblL/4 + e * (tblL/3), -rng() * 0.1); g.add(edgeR); } return g; },
  barStool: function(rng, p={}) { const g = new THREE.Group(); const seatH = p.seatHeight || 0.95; const seatD = 0.4, seatW = 0.4; const seatTop = ball(seatW / 2, 'leather-tan'); place(seatTop, 0, seatH, 0, 0); g.add(seatTop); const poleR = 0.018; const pole = cyl(poleR, poleR, seatH - 0.05, 'steel-brushed', 10); place(pole, 0, (seatH - 0.05) / 2, 0, 0); g.add(pole); const footring1 = cyl(0.25, 0.01, 0.03, 'brass', 12); place(footring1, 0, 0.35, 0, 0); g.add(footring1); const footring2 = cyl(0.22, 0.01, 0.025, 'steel-brushed', 12); place(footring2, 0, 0.15, 0, 0); g.add(footring2); const baseR = 0.28; const base = cyl(baseR, baseR, 0.04, 'steel-brushed', 8); place(base, 0, 0.02, 0, 0); g.add(base); for(let i = 0; i < 3; i++) { const angle = (i / 3) * Math.PI * 2 + rng() * 0.3; const supportDist = baseR * 0.85; const sx = Math.cos(angle) * supportDist; const sz = Math.sin(angle) * supportDist; const support = cyl(0.01, 0.01, 0.2, 'steel-brushed', 6); place(support, sx, 0.1, sz, 0); g.add(support); } const backrest = box(0.08, 0.4, seatW, 'leather-tan'); place(backrest, 0, seatH - 0.15, -seatW/2 + 0.05, rng() * 0.1 - 0.05); g.add(backrest); return g; },
  ottoman: function(rng, p={}) { const g = new THREE.Group(); const w = p.width || 0.6, d = p.depth || 0.5, h = p.height || 0.42; const topPad = 0.08; const cushionTop = box(w, topPad, d, 'fabric-linen'); place(cushionTop, 0, h - topPad/2, 0, rng() * 0.06 - 0.03); g.add(cushionTop); const cushionBody = box(w - 0.02, h - topPad, d - 0.02, 'fabric-grey'); place(cushionBody, 0, (h - topPad) / 2, 0, 0); g.add(cushionBody); const legR = 0.04; for(let leg = 0; leg < 4; leg++) { const lx = ((leg % 2) - 0.5) * (w - 0.08); const lz = (Math.floor(leg / 2) - 0.5) * (d - 0.08); const legGeom = cyl(legR, legR, 0.06, 'wood-walnut', 6); place(legGeom, lx, 0.03, lz, 0); g.add(legGeom); } const piping1 = box(w + 0.02, 0.012, 0.02, 'leather-tan'); place(piping1, 0, h - 0.01, -(d/2), 0); g.add(piping1); const piping2 = box(w + 0.02, 0.012, 0.02, 'leather-tan'); place(piping2, 0, h - 0.01, (d/2), 0); g.add(piping2); const piping3 = box(0.02, 0.012, d, 'leather-tan'); place(piping3, -(w/2), h - 0.01, 0, 0); g.add(piping3); const piping4 = box(0.02, 0.012, d, 'leather-tan'); place(piping4, (w/2), h - 0.01, 0, 0); g.add(piping4); return g; },
  sideTable: function(rng, p={}) { const g = new THREE.Group(); const w = p.width || 0.5, d = p.depth || 0.5, h = p.height || 0.55; const topThick = 0.03; const top = box(w, topThick, d, 'wood-walnut'); place(top, 0, h, 0, rng() * 0.08); g.add(top); const legW = 0.04; const legD = 0.04; const legs = [[-(w/2 - 0.05), -(d/2 - 0.05)], [-(w/2 - 0.05), (d/2 - 0.05)], [(w/2 - 0.05), -(d/2 - 0.05)], [(w/2 - 0.05), (d/2 - 0.05)]]; legs.forEach((pos, idx) => { const leg = box(legW, h, legD, 'wood-oak'); place(leg, pos[0], h/2, pos[1], idx % 2 === 0 ? rng() * 0.1 : -rng() * 0.1); g.add(leg); }); const shelfH = h * 0.4; const shelf = box(w - 0.02, 0.02, d - 0.02, 'wood-oak'); place(shelf, 0, shelfH, 0, 0); g.add(shelf); const supportL = cyl(0.015, 0.015, shelfH - 0.02, 'brass', 6); place(supportL, -(w/2 - 0.1), (shelfH - 0.02) / 2 + 0.01, 0, 0); g.add(supportL); const supportR = cyl(0.015, 0.015, shelfH - 0.02, 'brass', 6); place(supportR, (w/2 - 0.1), (shelfH - 0.02) / 2 + 0.01, 0, 0); g.add(supportR); const drawer = box(w - 0.06, 0.04, 0.06, 'wood-walnut'); place(drawer, 0, h * 0.15, d/2 - 0.05, 0); g.add(drawer); const drawerHandle = cyl(0.005, 0.005, 0.08, 'brass', 5); place(drawerHandle, 0, h * 0.15, d/2 + 0.02, Math.PI/2); g.add(drawerHandle); return g; },
  artFrame: function(rng, p={}) { const g = new THREE.Group(); const fw = p.frameWidth || 0.8, fh = p.frameHeight || 1.0; const framethick = 0.08; const innerW = fw - 2 * framethick; const innerH = fh - 2 * framethick; const frameL = box(framethick, fh, framethick, 'wood-walnut'); place(frameL, -(fw/2 - framethick/2), fh/2, framethick/2, 0); g.add(frameL); const frameR = box(framethick, fh, framethick, 'wood-walnut'); place(frameR, (fw/2 - framethick/2), fh/2, framethick/2, 0); g.add(frameR); const frameT = box(fw, framethick, framethick, 'wood-walnut'); place(frameT, 0, fh - framethick/2, framethick/2, 0); g.add(frameT); const frameB = box(fw, framethick, framethick, 'wood-walnut'); place(frameB, 0, framethick/2, framethick/2, 0); g.add(frameB); const matW = innerW * 0.9; const matH = innerH * 0.9; const mat = box(matW, 0.002, matH, 'ceramic-white'); place(mat, 0, fh/2, 0.04, 0); g.add(mat); const artW = matW * 0.85; const artH = matH * 0.85; const art = box(artW, 0.001, artH, 'concrete'); place(art, rng() * 0.02, fh/2 + 0.005, 0.05 + rng() * 0.01, rng() * 0.05 - 0.025); g.add(art); const glassPane = box(innerW, 0.004, innerH, 'glass-clear'); place(glassPane, 0, fh/2, 0.06, 0); g.add(glassPane); for(let c = 0; c < 4; c++) { const cornerRadius = 0.02; const cornersPos = [[-(fw/2 - framethick*0.5), fh - framethick*0.5], [(fw/2 - framethick*0.5), fh - framethick*0.5], [-(fw/2 - framethick*0.5), framethick*0.5], [(fw/2 - framethick*0.5), framethick*0.5]]; const corner = ball(cornerRadius, 'brass'); place(corner, cornersPos[c][0], cornersPos[c][1], framethick/2 + 0.01, 0); g.add(corner); } return g; },
  ceilingPendant: function(rng, p={}) { const g = new THREE.Group(); const canopyR = p.canopyRadius || 0.15; const canopy = cyl(canopyR, canopyR, 0.05, 'brass', 10); place(canopy, 0, 0, 0, 0); g.add(canopy); const chainSeg = 10; const linkR = 0.004; for(let link = 0; link < chainSeg; link++) { const chainLink = cyl(linkR, linkR, 0.03, 'brass', 4); place(chainLink, rng() * 0.01 - 0.005, -(link * 0.035), rng() * 0.01 - 0.005, rng() * Math.PI); g.add(chainLink); } const shadeR = p.shadeRadius || 0.18; const shadeH = p.shadeHeight || 0.25; const shade = cyl(shadeR, shadeR * 0.8, shadeH, 'fabric-grey', 12); place(shade, 0, -(chainSeg * 0.035 + shadeH/2), 0, 0); g.add(shade); const innerDiffuse = cyl(shadeR - 0.02, shadeR * 0.75, shadeH - 0.02, 'ceramic-white', 12); place(innerDiffuse, 0, -(chainSeg * 0.035 + shadeH/2), 0, 0); g.add(innerDiffuse); const bulbR = 0.02; const bulb = ball(bulbR, 'glass-clear'); place(bulb, 0, -(chainSeg * 0.035 + shadeH + 0.01), 0, 0); g.add(bulb); const bulbFilament = cyl(0.001, 0.001, 0.03, 'gold-polished', 3); place(bulbFilament, 0, -(chainSeg * 0.035 + shadeH + 0.01), 0, 0); g.add(bulbFilament); return g; },
  kitchenIsland: function(rng, p={}) { const g = new THREE.Group(); const w = p.width || 1.5, d = p.depth || 0.9, h = p.height || 0.95; const topH = 0.05; const body = box(w - 0.02, h - topH, d - 0.02, 'wood-oak'); place(body, 0, (h - topH)/2, 0, 0); g.add(body); const top = box(w, topH, d, 'marble-white'); place(top, 0, h, 0, rng() * 0.06 - 0.03); g.add(top); const drawerCount = 3; const drawerH = (h - topH - 0.05) / drawerCount; for(let dr = 0; dr < drawerCount; dr++) { const drawerY = 0.05 + (dr + 0.5) * drawerH; const drawerFront = box(w - 0.08, drawerH - 0.008, 0.06, 'wood-walnut'); place(drawerFront, 0, drawerY, d/2 - 0.02, 0); g.add(drawerFront); const handleL = cyl(0.007, 0.007, 0.12, 'copper', 5); place(handleL, -w/4, drawerY, d/2 + 0.03, Math.PI/2); g.add(handleL); const handleR = cyl(0.007, 0.007, 0.12, 'copper', 5); place(handleR, w/4, drawerY, d/2 + 0.03, Math.PI/2); g.add(handleR); } const legW = 0.08; const legD = 0.08; for(let i = 0; i < 2; i++) { const legX = ((i - 0.5) * 2) * (w/2 - 0.15); const legPair = box(legW, h, legD, 'wood-oak'); place(legPair, legX, h/2, 0, 0); g.add(legPair); } for(let i = 0; i < 2; i++) { const angle = (i / 2) * Math.PI; const supportX = Math.cos(angle) * (w/2 - 0.2); const supportZ = Math.sin(angle) * (d/2 - 0.1); const support = cyl(0.025, 0.025, h - 0.1, 'steel-brushed', 8); place(support, supportX, h/2, supportZ, 0); g.add(support); } const overhang = 0.08; const overTop = box(w + overhang * 2, 0.04, d + overhang, 'marble-white'); place(overTop, 0, h + 0.025, 0, 0); g.add(overTop); return g; },
  kitchenCabinetRun: function(rng, p={}) { const g = new THREE.Group(); const unitW = p.unitWidth || 0.6; const units = p.units || 3; const totalW = unitW * units; const h = p.height || 0.9; const d = p.depth || 0.65; const topH = 0.04; for(let u = 0; u < units; u++) { const unitX = -(totalW/2) + unitW/2 + u * unitW; const body = box(unitW - 0.01, h - topH, d - 0.01, 'wood-oak'); place(body, unitX, (h - topH)/2, 0, 0); g.add(body); const doorW = (unitW - 0.06) / 2; const doorH = h - topH - 0.05; const doorL = box(doorW, doorH, 0.04, 'wood-walnut'); place(doorL, unitX - doorW/2 - 0.015, h/2, d/2 + 0.02, rng() * 0.05); g.add(doorL); const doorR = box(doorW, doorH, 0.04, 'wood-walnut'); place(doorR, unitX + doorW/2 + 0.015, h/2, d/2 + 0.02, -rng() * 0.05); g.add(doorR); const handleL = cyl(0.006, 0.006, 0.1, 'brass', 5); place(handleL, unitX - doorW/2, h - 0.25, d/2 + 0.05, Math.PI/2); g.add(handleL); const handleR = cyl(0.006, 0.006, 0.1, 'brass', 5); place(handleR, unitX + doorW/2, h - 0.25, d/2 + 0.05, Math.PI/2); g.add(handleR); } const top = box(totalW, topH, d, 'marble-white'); place(top, 0, h, 0, 0); g.add(top); const backSplash = box(totalW, 0.35, 0.03, 'ceramic-white'); place(backSplash, 0, h + 0.25, -d/2 - 0.01, 0); g.add(backSplash); const baseBoard = box(totalW, 0.06, 0.08, 'wood-oak'); place(baseBoard, 0, 0.03, 0, 0); g.add(baseBoard); for(let u = 0; u < units + 1; u++) { const divX = -(totalW/2) + u * unitW; const divider = box(0.01, h - 0.06, d - 0.02, 'wood-oak'); place(divider, divX, h/2, 0, 0); g.add(divider); } return g; },

  // ── office: a flat desktop monitor on a stand (screen + bezel + neck + foot) ──
  monitor: function(rng, p={}) { const g = new THREE.Group(); const scrW = p.width || 0.62, scrH = p.height || 0.38; const bezel = 0.015; const panel = box(scrW, scrH, 0.03, 'plastic-matte'); place(panel, 0, scrH/2 + 0.18, 0, 0); g.add(panel); const screen = box(scrW - bezel*2, scrH - bezel*2, 0.004, 'glass-clear'); place(screen, 0, scrH/2 + 0.18, 0.018, 0); g.add(screen); const neck = box(0.05, 0.18, 0.04, 'aluminium'); place(neck, 0, 0.1, -0.02, 0); g.add(neck); const foot = box(0.24, 0.02, 0.18, 'aluminium'); place(foot, 0, 0.01, 0, rng()*0.04 - 0.02); g.add(foot); return g; },
  // ── compact desk lamp: weighted base, jointed arm, cone head ──
  deskLamp: function(rng, p={}) { const g = new THREE.Group(); const base = cyl(0.09, 0.1, 0.03, 'steel-brushed', 16); place(base, 0, 0.015, 0, 0); g.add(base); const lowerH = 0.32; const lower = cyl(0.012, 0.012, lowerH, 'steel-brushed', 8); place(lower, 0, 0.03 + lowerH/2, 0, rng()*0.1 - 0.05); lower.rotation.z = 0.25; g.add(lower); const upperH = 0.3; const upper = cyl(0.012, 0.012, upperH, 'steel-brushed', 8); const ux = Math.sin(0.25) * lowerH; place(upper, ux, 0.03 + Math.cos(0.25)*lowerH, 0, 0); upper.rotation.z = -0.6; g.add(upper); const headX = ux + Math.sin(-0.6) * upperH * 0.5; const head = cyl(0.05, 0.08, 0.1, 'brass', 12); place(head, headX, 0.03 + Math.cos(0.25)*lowerH + upperH*0.4, 0, 0); head.rotation.z = -1.1; g.add(head); const bulb = ball(0.025, 'ceramic-white'); place(bulb, headX, 0.03 + Math.cos(0.25)*lowerH + upperH*0.4 - 0.04, 0, 0); g.add(bulb); return g; },
  // ── espresso machine block: hopper body, group heads, drip tray, portafilter ──
  espressoMachine: function(rng, p={}) { const g = new THREE.Group(); const w = p.width || 0.7, h = p.height || 0.5, d = p.depth || 0.45; const body = box(w, h, d, 'steel-polished'); place(body, 0, h/2, 0, 0); g.add(body); const topTray = box(w - 0.06, 0.04, d - 0.06, 'steel-brushed'); place(topTray, 0, h + 0.02, 0, 0); g.add(topTray); for(let cup = 0; cup < 3; cup++) { const ccx = -w/4 + cup * (w/4); const cupMug = cyl(0.04, 0.035, 0.08, 'ceramic-white', 12); place(cupMug, ccx, h + 0.08, 0, rng()*0.2); g.add(cupMug); } for(let gh = 0; gh < 2; gh++) { const ghx = (gh - 0.5) * 0.3; const groupHead = cyl(0.045, 0.05, 0.12, 'steel-polished', 12); place(groupHead, ghx, h - 0.18, d/2 - 0.02, 0); g.add(groupHead); const portafilter = box(0.18, 0.025, 0.045, 'rubber-black'); place(portafilter, ghx, h - 0.27, d/2 + 0.08, 0); g.add(portafilter); const handle = cyl(0.012, 0.012, 0.1, 'rubber-black', 6); place(handle, ghx, h - 0.27, d/2 + 0.16, Math.PI/2); g.add(handle); } const steamWand = cyl(0.008, 0.008, 0.22, 'steel-polished', 6); place(steamWand, -w/2 + 0.05, h - 0.12, d/2 - 0.05, 0); steamWand.rotation.x = 0.3; g.add(steamWand); const dripTray = box(w - 0.08, 0.03, d - 0.1, 'steel-brushed'); place(dripTray, 0, 0.02, d/2 - 0.06, 0); g.add(dripTray); const gauge = cyl(0.04, 0.04, 0.015, 'brass', 16); place(gauge, w/2 - 0.12, h - 0.1, d/2 + 0.01, Math.PI/2); g.add(gauge); return g; },
  // ── sideboard / credenza: low cabinet on splayed legs with doors + handles ──
  sideboard: function(rng, p={}) { const g = new THREE.Group(); const w = p.width || 1.6, h = p.height || 0.8, d = p.depth || 0.45; const legH = 0.12, topH = 0.04; const body = box(w - 0.04, h - topH - legH, d - 0.04, 'wood-walnut'); place(body, 0, legH + (h - topH - legH)/2, 0, 0); g.add(body); const top = box(w, topH, d, 'wood-oak'); place(top, 0, h - topH/2, 0, rng()*0.04 - 0.02); g.add(top); const doors = 3; const doorW = (w - 0.1) / doors; for(let dr = 0; dr < doors; dr++) { const dx = -(w/2) + 0.05 + doorW/2 + dr * doorW; const door = box(doorW - 0.02, h - topH - legH - 0.04, 0.03, 'wood-oak'); place(door, dx, legH + (h - topH - legH)/2, d/2 - 0.01, rng()*0.04 - 0.02); g.add(door); const handle = cyl(0.006, 0.006, 0.12, 'brass', 6); place(handle, dx, legH + (h - topH - legH)/2, d/2 + 0.03, 0); g.add(handle); } for(let leg = 0; leg < 4; leg++) { const lx = ((leg % 2) - 0.5) * (w - 0.2); const lz = (Math.floor(leg/2) - 0.5) * (d - 0.12); const legGeom = cyl(0.02, 0.03, legH, 'wood-walnut', 8); place(legGeom, lx, legH/2, lz, 0); legGeom.rotation.x = lz > 0 ? 0.12 : -0.12; legGeom.rotation.z = lx > 0 ? -0.12 : 0.12; g.add(legGeom); } return g; },
  // ── mannequin block: torso + head + plinth (retail dress form) ──
  mannequin: function(rng, p={}) { const g = new THREE.Group(); const plinth = cyl(0.18, 0.2, 0.05, 'steel-brushed', 20); place(plinth, 0, 0.025, 0, 0); g.add(plinth); const pole = cyl(0.02, 0.02, 0.55, 'steel-polished', 10); place(pole, 0, 0.05 + 0.275, 0, 0); g.add(pole); const torso = box(0.34, 0.62, 0.22, 'fabric-linen'); place(torso, 0, 1.05, 0, rng()*0.08 - 0.04); g.add(torso); const shoulderL = ball(0.09, 'fabric-linen'); place(shoulderL, -0.17, 1.32, 0, 0); g.add(shoulderL); const shoulderR = ball(0.09, 'fabric-linen'); place(shoulderR, 0.17, 1.32, 0, 0); g.add(shoulderR); const neck = cyl(0.045, 0.05, 0.08, 'fabric-linen', 12); place(neck, 0, 1.42, 0, 0); g.add(neck); const head = ball(0.085, 'ceramic-white'); place(head, 0, 1.52, 0, rng()*0.15 - 0.075); g.add(head); const waist = cyl(0.16, 0.12, 0.14, 'fabric-grey', 16); place(waist, 0, 0.74, 0, 0); g.add(waist); return g; },
  // ── clothing rack: rail on two legs, hung garments as draped boxes ──
  clothingRack: function(rng, p={}) { const g = new THREE.Group(); const w = p.width || 1.3, h = p.height || 1.6; const railR = 0.012; const rail = cyl(railR, railR, w, 'steel-polished', 10); place(rail, 0, h, 0, 0); rail.rotation.z = Math.PI/2; g.add(rail); for(let leg = 0; leg < 2; leg++) { const lx = (leg - 0.5) * w; const post = cyl(0.02, 0.02, h, 'steel-brushed', 8); place(post, lx, h/2, 0, 0); g.add(post); const footBar = box(0.04, 0.03, 0.5, 'steel-brushed'); place(footBar, lx, 0.02, 0, 0); g.add(footBar); for(const fz of [-1, 1]) { const wheel = cyl(0.03, 0.03, 0.02, 'rubber-black', 10); place(wheel, lx, 0.03, fz * 0.22, Math.PI/2); g.add(wheel); } } const garments = p.garments || 7; const mats = ['fabric-grey', 'fabric-linen', 'leather-tan', 'wood-walnut', 'velvet']; for(let gar = 0; gar < garments; gar++) { const gx = -w/2 + 0.12 + gar * ((w - 0.24) / (garments - 1)); const hangerW = 0.06 + rng()*0.02; const hook = cyl(0.004, 0.004, 0.08, 'steel-polished', 6); place(hook, gx, h - 0.02, 0, 0); g.add(hook); const shoulder = box(hangerW * 3, 0.01, 0.02, 'plastic-matte'); place(shoulder, gx, h - 0.07, 0, rng()*0.1 - 0.05); g.add(shoulder); const garmentH = 0.7 + rng()*0.4; const garment = box(0.22 + rng()*0.06, garmentH, 0.06, mats[gar % mats.length]); place(garment, gx, h - 0.07 - garmentH/2, 0, rng()*0.06 - 0.03); g.add(garment); } return g; },
  // ── bathroom vanity: cabinet + countertop + vessel basin + faucet + mirror ──
  vanity: function(rng, p={}) { const g = new THREE.Group(); const w = p.width || 1.1, h = p.height || 0.82, d = p.depth || 0.5; const topH = 0.04; const cabinet = box(w - 0.04, h - topH, d - 0.04, 'wood-walnut'); place(cabinet, 0, (h - topH)/2, 0, 0); g.add(cabinet); const top = box(w, topH, d, 'marble-white'); place(top, 0, h, 0, rng()*0.03 - 0.015); g.add(top); for(let dr = 0; dr < 2; dr++) { const dx = (dr - 0.5) * (w/2 - 0.05); const door = box(w/2 - 0.06, h - topH - 0.06, 0.03, 'wood-oak'); place(door, dx, (h - topH)/2, d/2 - 0.01, rng()*0.04 - 0.02); g.add(door); const handle = cyl(0.005, 0.005, 0.1, 'brass', 6); place(handle, dx + (dr - 0.5) * 0.18, (h - topH)/2, d/2 + 0.03, 0); g.add(handle); } const basin = cyl(0.18, 0.14, 0.12, 'ceramic-white', 24); place(basin, 0, h + 0.06, 0, 0); g.add(basin); const basinInner = cyl(0.15, 0.1, 0.1, 'ceramic-white', 24); place(basinInner, 0, h + 0.09, 0, 0); g.add(basinInner); const faucetBase = cyl(0.025, 0.03, 0.04, 'steel-polished', 12); place(faucetBase, 0, h + 0.05, -d/2 + 0.12, 0); g.add(faucetBase); const faucetNeck = cyl(0.012, 0.012, 0.22, 'steel-polished', 10); place(faucetNeck, 0, h + 0.16, -d/2 + 0.12, 0); faucetNeck.rotation.x = -0.4; g.add(faucetNeck); const faucetSpout = cyl(0.01, 0.01, 0.08, 'steel-polished', 10); place(faucetSpout, 0, h + 0.26, -d/2 + 0.18, 0); faucetSpout.rotation.x = Math.PI/2; g.add(faucetSpout); const mirror = box(w * 0.7, 0.9, 0.02, 'glass-clear'); place(mirror, 0, h + 0.75, -d/2 + 0.02, 0); g.add(mirror); const mirrorFrame = box(w * 0.74, 0.94, 0.015, 'brass'); place(mirrorFrame, 0, h + 0.75, -d/2 + 0.005, 0); g.add(mirrorFrame); return g; },
  // ── freestanding bathtub: oval shell + inner bowl + clawed feet + filler ──
  bathtub: function(rng, p={}) { const g = new THREE.Group(); const w = p.width || 0.78, len = p.length || 1.7, h = p.height || 0.6; const shell = box(w, h - 0.1, len, 'ceramic-white'); place(shell, 0, 0.1 + (h - 0.1)/2, 0, 0); g.add(shell); const rim = box(w + 0.04, 0.06, len + 0.04, 'ceramic-white'); place(rim, 0, h, 0, 0); g.add(rim); const inner = box(w - 0.14, 0.3, len - 0.18, 'ceramic-white'); place(inner, 0, h - 0.12, 0, 0); g.add(inner); const water = box(w - 0.18, 0.02, len - 0.22, 'glass-clear'); place(water, 0, h - 0.16, 0, 0); g.add(water); for(let foot = 0; foot < 4; foot++) { const fx = ((foot % 2) - 0.5) * (w - 0.1); const fz = (Math.floor(foot/2) - 0.5) * (len - 0.2); const claw = cyl(0.04, 0.06, 0.1, 'brass', 10); place(claw, fx, 0.05, fz, 0); g.add(claw); } const filler = cyl(0.015, 0.015, 0.3, 'steel-polished', 10); place(filler, 0, h + 0.15, -len/2 + 0.1, 0); g.add(filler); const fillerSpout = cyl(0.012, 0.012, 0.1, 'steel-polished', 10); place(fillerSpout, 0, h + 0.3, -len/2 + 0.15, 0); fillerSpout.rotation.x = Math.PI/2; g.add(fillerSpout); return g; },
  // ── towel rack: wall ladder rail with draped folded towels ──
  towelRack: function(rng, p={}) { const g = new THREE.Group(); const w = p.width || 0.6, h = p.height || 1.0; for(const side of [-1, 1]) { const post = cyl(0.012, 0.012, h, 'steel-brushed', 8); place(post, side * w/2, h/2, 0, 0); g.add(post); } const rungs = 4; for(let r = 0; r < rungs; r++) { const ry = 0.15 + r * ((h - 0.2) / rungs); const rung = cyl(0.01, 0.01, w, 'steel-brushed', 8); place(rung, 0, ry, 0, 0); rung.rotation.z = Math.PI/2; g.add(rung); if(r % 2 === 0) { const towel = box(w * 0.6, 0.4, 0.04, r === 0 ? 'fabric-linen' : 'fabric-grey'); place(towel, rng()*0.04 - 0.02, ry - 0.18, 0.05, 0); g.add(towel); } } return g; },
};

const LAYOUTS = {
  'living-room': (scene, rng) => {
    addJittered(scene, rug(rng, {}), 0, 0.1, 0, rng);
    addJittered(scene, sofa(rng, { fabric: 'fabric-grey' }), 0, -0.9, 0, rng);
    addJittered(scene, coffeeTable(rng, {}), 0, 0.15, 0, rng);
    addJittered(scene, armchair(rng, { fabric: 'leather-tan' }), -1.45, 0.5, 0.7, rng);
    addJittered(scene, armchair(rng, { fabric: 'fabric-linen' }), 1.45, 0.5, -0.7, rng);
    addJittered(scene, floorLamp(rng, {}), -1.7, -1.0, 0, rng);
    addJittered(scene, bookshelf(rng, {}), 1.9, -1.3, -0.5, rng);
    addJittered(scene, plant(rng, {}), -2.0, 0.9, 0, rng);
  },
  'bedroom': (scene, rng) => {
    addJittered(scene, rug(rng, { w: 2.8, d: 2.0 }), 0, 0.3, 0, rng);
    addJittered(scene, bed(rng, {}), 0, -0.3, 0, rng);
    addJittered(scene, nightstand(rng, {}), -1.15, -1.1, 0, rng);
    addJittered(scene, nightstand(rng, {}), 1.15, -1.1, 0, rng);
    addJittered(scene, floorLamp(rng, { h: 1.4 }), 1.5, -1.2, 0, rng);
    addJittered(scene, plant(rng, { h: 0.9 }), -1.7, 1.1, 0, rng);
    addJittered(scene, bookshelf(rng, { h: 1.4, w: 0.8 }), 1.9, 1.0, -0.4, rng);
  },
  'product': (scene, rng) => {
    addJittered(scene, backdrop(rng, {}), 0, 0, 0, rng);
    addJittered(scene, pedestal(rng, {}), 0, 0, 0, rng);
    const hero = productHero(rng); hero.position.y = 0.95; addJittered(scene, hero, 0, 0, 0, rng, 0, 0);
  },
  'kitchen': (scene, rng) => {
    addJittered(scene, XF.kitchenCabinetRun(rng, {}), 0, -1.7, 0, rng);
    addJittered(scene, XF.kitchenIsland(rng, {}), 0, 0.4, 0, rng);
    for (let i = 0; i < 3; i++) addJittered(scene, XF.barStool(rng, {}), -0.7 + i * 0.7, 1.15, 0, rng);
    addJittered(scene, XF.ceilingPendant(rng, {}), -0.5, 0.4, 0, rng);
    addJittered(scene, XF.ceilingPendant(rng, {}), 0.5, 0.4, 0, rng);
    addJittered(scene, plant(rng, {}), 1.9, -1.0, 0, rng);
  },
  // ─── new layouts (6) ───
  'office': (scene, rng) => {
    addJittered(scene, rug(rng, { w: 2.6, d: 1.9 }), 0, 0.2, 0, rng);
    addJittered(scene, XF.desk(rng, { width: 1.5, depth: 0.7 }), 0, -0.9, 0, rng);          // desk against back
    addJittered(scene, XF.monitor(rng, {}), 0, -1.05, 0, rng);                              // monitor on desk
    addJittered(scene, XF.deskLamp(rng, {}), 0.55, -1.0, 0, rng);                           // desk lamp corner
    addJittered(scene, XF.officeChair(rng, {}), 0, -0.15, Math.PI, rng);                    // chair facing desk
    addJittered(scene, bookshelf(rng, { w: 1.1, h: 1.95 }), -1.95, -1.0, Math.PI / 2, rng); // bookshelf left wall
    addJittered(scene, plant(rng, {}), 1.9, -1.2, 0, rng);                                  // plant corner
  },
  'cafe': (scene, rng) => {
    addJittered(scene, counter(rng, { w: 2.4 }), -1.7, -1.25, 0.18, rng);                   // service counter
    addJittered(scene, XF.espressoMachine(rng, {}), -1.7, -1.05, 0, rng);                   // espresso block on counter
    addJittered(scene, bookshelf(rng, { w: 0.9, h: 1.6, d: 0.28 }), -2.0, 0.9, Math.PI / 2, rng); // shelf of cups/mugs
    for (let i = 0; i < 3; i++) {
      const tx = -0.4 + i * 1.05;
      addJittered(scene, coffeeTable(rng, { w: 0.7, d: 0.7, h: 0.74, top: 'wood-walnut' }), tx, 0.7, 0, rng); // round-ish table
      addJittered(scene, chair(rng, {}), tx - 0.5, 1.15, Math.PI / 2, rng);                 // chair one side
      addJittered(scene, chair(rng, {}), tx + 0.5, 0.25, -Math.PI / 2, rng);                // chair other side
      addJittered(scene, pendant(rng, { y: 2.05 }), tx, 0.7, 0, rng);                       // pendant over each table
    }
    addJittered(scene, plant(rng, {}), 1.95, -1.2, 0, rng);
  },
  'dining-room': (scene, rng) => {
    addJittered(scene, rug(rng, { w: 3.2, d: 2.1 }), 0, 0, 0, rng);
    addJittered(scene, XF.diningTableLong(rng, { length: 2.4, width: 1.0 }), 0, 0, 0, rng); // table center
    for (let i = 0; i < 3; i++) {                                                            // 6 chairs, 3 per side
      addJittered(scene, chair(rng, {}), -0.8 + i * 0.8, 0.8, 0, rng);
      addJittered(scene, chair(rng, {}), -0.8 + i * 0.8, -0.8, Math.PI, rng);
    }
    addJittered(scene, XF.sideboard(rng, {}), 0, -1.95, 0, rng);                            // sideboard back wall
    addJittered(scene, XF.ceilingPendant(rng, {}), 0, 0, 0, rng);                           // hanging light over table
    addJittered(scene, plant(rng, { h: 1.2 }), 0, 0.05, 0, rng, 0, 0);                      // centerpiece on table
  },
  'lounge': (scene, rng) => {
    addJittered(scene, rug(rng, { w: 3.0, d: 2.2 }), 0, 0.1, 0, rng);
    addJittered(scene, sofa(rng, { w: 2.3, fabric: 'velvet' }), 0, -1.0, 0, rng);           // statement sofa
    addJittered(scene, coffeeTable(rng, { w: 1.3, d: 0.7 }), 0, 0.2, 0, rng);               // coffee table
    addJittered(scene, armchair(rng, { fabric: 'leather-tan' }), -1.6, 0.6, 0.6, rng);      // armchair L
    addJittered(scene, armchair(rng, { fabric: 'fabric-linen' }), 1.6, 0.6, -0.6, rng);     // armchair R
    addJittered(scene, XF.sideTable(rng, {}), 1.45, -0.7, 0, rng);                          // side table
    addJittered(scene, floorLamp(rng, {}), -1.85, -1.1, 0, rng);                            // floor lamp
    addJittered(scene, bookshelf(rng, { w: 1.1, h: 1.95 }), 1.95, -1.3, -Math.PI / 2, rng); // bookshelf corner
  },
  'retail': (scene, rng) => {
    addJittered(scene, counter(rng, { w: 1.8, top: 'marble-white', body: 'wood-walnut' }), 0, -1.7, 0, rng); // display/cash counter
    addJittered(scene, XF.clothingRack(rng, {}), -1.5, 0.3, 0, rng);                        // clothing rack L
    addJittered(scene, XF.clothingRack(rng, { width: 1.1 }), 1.5, 0.3, 0, rng);             // clothing rack R
    addJittered(scene, bookshelf(rng, { w: 1.2, h: 1.9, d: 0.34 }), -2.0, -1.2, Math.PI / 2, rng); // shelving wall
    addJittered(scene, XF.mannequin(rng, {}), 0, 0.9, 0, rng);                              // mannequin display
    addJittered(scene, XF.ottoman(rng, { width: 0.9 }), 1.4, 1.4, 0, rng);                  // fitting bench
    addJittered(scene, pendant(rng, { y: 2.2, shade: 'steel-brushed' }), -0.8, 0.0, 0, rng); // spotlight
    addJittered(scene, pendant(rng, { y: 2.2, shade: 'steel-brushed' }), 0.8, 0.0, 0, rng);  // spotlight
  },
  'bathroom-spa': (scene, rng) => {
    addJittered(scene, rug(rng, { w: 1.4, d: 0.8, mat: 'fabric-linen' }), 0, 1.0, 0, rng);  // bath mat
    addJittered(scene, XF.vanity(rng, {}), -1.55, -1.2, Math.PI / 2, rng);                  // vanity + sink + mirror, left wall
    addJittered(scene, XF.bathtub(rng, {}), 1.4, -0.6, Math.PI / 2, rng);                   // freestanding tub, right
    addJittered(scene, XF.towelRack(rng, {}), -1.95, 0.6, Math.PI / 2, rng);                // towel rack on wall
    addJittered(scene, plant(rng, { h: 1.2 }), 1.85, 1.2, 0, rng);                          // spa plant
    addJittered(scene, plant(rng, { h: 0.8 }), -0.4, 1.4, 0, rng);                          // small plant
    addJittered(scene, pedestal(rng, { mat: 'marble-white', h: 0.55 }), 0.3, 1.3, 0, rng);  // marble accent stool / tiled-floor accent
  },
};

export function composeScene(layoutId, scene, seed = 1337) {
  scene = scene || (typeof window !== 'undefined' && (window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene)));
  if (!scene) throw new Error('composeScene: no scene');
  // clear existing prims
  const doomed = [];
  scene.traverse((o) => { if (o && (o.userData?.archdiscStudioPrimitive || o.userData?.archdiscStudioLight)) doomed.push(o); });
  for (const o of doomed) { o.geometry?.dispose?.(); o.material?.dispose?.(); o.parent?.remove(o); }
  const fn = LAYOUTS[layoutId] || LAYOUTS['living-room'];
  const rng = makeRng(seed);
  fn(scene, rng);
  let n = 0; scene.traverse((o) => { if (o.userData?.archdiscStudioPrimitive) n++; });
  return { layout: layoutId, bodies: n };
}

export const STUDIO_LAYOUT_IDS = Object.keys(LAYOUTS);

export function installStudioComposer() {
  if (typeof window === 'undefined') return;
  window.__studioComposeScene = (layoutId, seed) => composeScene(layoutId, null, seed);
}
