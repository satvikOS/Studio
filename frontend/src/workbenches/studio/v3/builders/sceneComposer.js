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
