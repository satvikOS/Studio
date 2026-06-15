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
  'cafe': (scene, rng) => {
    addJittered(scene, counter(rng, {}), -1.6, -1.2, 0.15, rng);
    for (let i = 0; i < 3; i++) {
      const tx = -0.6 + i * 1.0;
      addJittered(scene, coffeeTable(rng, { w: 0.7, d: 0.7, h: 0.74, top: 'wood-walnut' }), tx, 0.6, 0, rng);
      addJittered(scene, chair(rng, {}), tx - 0.5, 1.05, Math.PI / 2, rng);
      addJittered(scene, chair(rng, {}), tx + 0.5, 0.15, -Math.PI / 2, rng);
      addJittered(scene, pendant(rng, { y: 2.0 }), tx, 0.6, 0, rng);
    }
    addJittered(scene, plant(rng, {}), 1.9, -1.2, 0, rng);
  },
  'office': (scene, rng) => {
    addJittered(scene, rug(rng, { w: 2.6, d: 1.9 }), 0, 0.2, 0, rng);
    addJittered(scene, XF.desk(rng, {}), 0, -0.8, 0, rng);
    addJittered(scene, XF.officeChair(rng, {}), 0, 0.0, Math.PI, rng);
    addJittered(scene, XF.wardrobe(rng, {}), 1.95, -1.2, -0.35, rng);
    addJittered(scene, bookshelf(rng, {}), -1.95, -1.1, 0.35, rng);
    addJittered(scene, XF.sideTable(rng, {}), 1.5, 1.0, 0, rng);
    addJittered(scene, plant(rng, {}), -1.8, 1.1, 0, rng);
  },
  'dining': (scene, rng) => {
    addJittered(scene, rug(rng, { w: 3.0, d: 2.0 }), 0, 0, 0, rng);
    addJittered(scene, XF.diningTableLong(rng, {}), 0, 0, 0, rng);
    for (let i = 0; i < 3; i++) {
      addJittered(scene, chair(rng, {}), -0.8 + i * 0.8, 0.78, 0, rng);
      addJittered(scene, chair(rng, {}), -0.8 + i * 0.8, -0.78, Math.PI, rng);
    }
    addJittered(scene, XF.ceilingPendant(rng, {}), 0, 0, 0, rng);
    addJittered(scene, XF.dresser(rng, {}), 1.95, -1.3, -0.3, rng);
    addJittered(scene, plant(rng, {}), -2.0, 1.0, 0, rng);
  },
  'kitchen': (scene, rng) => {
    addJittered(scene, XF.kitchenCabinetRun(rng, {}), 0, -1.7, 0, rng);
    addJittered(scene, XF.kitchenIsland(rng, {}), 0, 0.4, 0, rng);
    for (let i = 0; i < 3; i++) addJittered(scene, XF.barStool(rng, {}), -0.7 + i * 0.7, 1.15, 0, rng);
    addJittered(scene, XF.ceilingPendant(rng, {}), -0.5, 0.4, 0, rng);
    addJittered(scene, XF.ceilingPendant(rng, {}), 0.5, 0.4, 0, rng);
    addJittered(scene, plant(rng, {}), 1.9, -1.0, 0, rng);
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
