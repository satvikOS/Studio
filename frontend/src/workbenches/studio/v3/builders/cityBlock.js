// ArchDisc Studio V3 — procedural CITY BLOCK builder (no imports, pure THREE).
//
// window.__studioBuildCity({ blocks, seed }) constructs a coherent, WALKABLE
// city block out of primitives + extrusions: a ground plane with asphalt
// streets, raised concrete SIDEWALKS, painted LANE MARKINGS + a zebra crossing;
// a grid of VARIED buildings (boxes with floor/window banding done as inset
// glass strips, stepped SETBACKS up the tower, a parapet + ROOFTOP UNITS —
// AC boxes, a water tank, a stair/lift bulkhead); and STREET PROPS — lamp posts
// with a head + arm, slatted benches, a few boxy CARS (body + cabin + wheels),
// and TREES (a trunk + layered canopy). Everything is sensibly scaled so the
// humanoid (≈1.8 m) can walk the street: the carriageway is ~9 m, sidewalks
// ~3 m, blocks ~26 m on a side.
//
// Each emitted mesh is tagged userData.archdiscStudioPrimitive (so the demo
// body-count + the path tracer's harvestScene() pick it up) and carries a
// userData.studioMaterial materialRegistry id (concrete / steel-brushed /
// ceramic-white / glass-clear / wood-oak / asphalt-ish plastic / rubber) so the
// real 4K PBR pipeline shades it instead of rendering flat clay.
//
// Mirrors sceneComposer.js conventions exactly: deterministic makeRng, the
// box/cyl/ball part helpers, and the addBaked() collect-then-add pass that
// bakes each part's world transform into its geometry and re-parents it to the
// scene root as a flat, individually-counted, individually-materialed primitive
// (so nothing is a hidden child the harvester skips).
//
// Fully local: pure THREE (already a v3 dep) + RoundedBoxGeometry (three
// examples, already used by sceneComposer). No network, no new packages.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MATERIALS } from '../materialRegistry.js';
import {
  loadPropMaster, scaleToTarget, PROP_MAP, VEHICLE_ASSETS, TREE_ASSETS, BUILDING_ASSETS,
} from './realCharacter.js';

// Deterministic RNG — same LCG sceneComposer uses, so a seed reproduces a city.
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// MeshStandardMaterial from a registry id (harvestScene rebuilds the physical
// material from userData.studioMaterial; this is the live-viewport stand-in).
function matFor(id) {
  const m = MATERIALS[id] || MATERIALS['plastic-matte'];
  return new THREE.MeshStandardMaterial({
    color: m.color, metalness: m.metalness ?? 0.0, roughness: m.roughness ?? 0.6,
    transparent: !!m.transmission, opacity: m.transmission ? 0.55 : 1.0,
  });
}

// ── part helpers (rounded box / cylinder / sphere / flat slab) ───────────────
function box(w, h, d, mat, round = true) {
  let g;
  if (round) {
    const r = Math.min(w, h, d) * 0.04;
    g = new RoundedBoxGeometry(w, h, d, 2, Math.max(r, 0.004));
  } else {
    g = new THREE.BoxGeometry(w, h, d);
  }
  const m = new THREE.Mesh(g, matFor(mat));
  m.userData.studioMaterial = mat;
  return m;
}
function slab(w, h, d, mat) { return box(w, h, d, mat, false); } // sharp ground/road
function cyl(rt, rb, h, mat, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), matFor(mat));
  m.userData.studioMaterial = mat;
  return m;
}
function ball(r, mat, seg = 16) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg / 2)), matFor(mat));
  m.userData.studioMaterial = mat;
  return m;
}
function place(mesh, x, y, z, ry = 0) { mesh.position.set(x, y, z); mesh.rotation.y = ry; return mesh; }

// ─────────────────────────────────────────────────────────────────────────────
//  scale constants — a real, walkable street grid (metres)
// ─────────────────────────────────────────────────────────────────────────────
const ROAD_W = 9.0;       // carriageway width (two lanes)
const SIDEWALK_W = 3.0;   // pavement either side
const CURB_H = 0.16;      // sidewalk lip above the asphalt
const PLOT = 26.0;        // building-plot side (block interior)
const CELL = PLOT + ROAD_W + 2 * SIDEWALK_W; // grid pitch (plot + half-road both sides)

// ── façade material palette (varied but coherent stone/brick/steel towers) ───
// 'facade' = real CC0 brick-facade PBR scan (ambientCG Bricks097); mixed with the
// concrete/steel/ceramic registry sets so the skyline reads varied.
const FACADE_MATS = ['facade', 'concrete', 'steel-brushed', 'facade', 'ceramic-white'];

// ─────────────────────────────────────────────────────────────────────────────
//  BUILDING — a stepped box tower with floor/window banding + rooftop units.
//  Returns a Group; the floor banding is done as INSET glass strips ringing the
//  tower at each storey so the path tracer reads a real glazed façade, not a
//  painted texture. Setbacks step the tower in as it rises.
// ─────────────────────────────────────────────────────────────────────────────
// A grid of recessed window PANES + vertical/horizontal MULLIONS across one
// façade face. Glass is set BACK from the wall plane (recessed reveal) so the PT
// reads real depth + a shadow-line at each opening; the mullion lattice is a
// brighter trim. `axis` = 'x' (face spans X, normal ±Z) or 'z' (spans Z, normal
// ±X). All panes/mullions for the face are pushed into `parts[mat]` arrays and
// merged once per building → a handful of meshes, not hundreds.
function windowGridFace(parts, { w, h, yMid, faceSign, axis, glassMat, mullMat }) {
  const span = axis === 'x' ? w : w;        // horizontal extent of the face
  const cols = Math.max(2, Math.round(span / 1.8));   // ~1.8 m bays
  const rows = Math.max(1, Math.round(h / 1.7));      // ~1.7 m tall openings
  const margin = 0.5;                                  // solid wall border
  const usableW = span - margin * 2, usableH = h - margin * 2;
  if (usableW <= 0.4 || usableH <= 0.4) return;
  const cellW = usableW / cols, cellH = usableH / rows;
  const paneW = cellW * 0.74, paneH = cellH * 0.70;    // glass area inside each bay
  const mullW = 0.06;                                  // mullion bar thickness
  const reveal = 0.10;                                 // glass set back from wall
  const wallPlane = axis === 'x' ? (parts.__dz / 2) : (parts.__dx / 2);
  const gz = (wallPlane - reveal) * faceSign;          // glass depth
  const mz = (wallPlane - 0.02) * faceSign;            // mullion just proud of glass
  const x0 = -usableW / 2 + cellW / 2;
  const y0 = yMid - usableH / 2 + cellH / 2;
  const G = parts[glassMat] || (parts[glassMat] = []);
  const M = parts[mullMat] || (parts[mullMat] = []);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = x0 + c * cellW, cy = y0 + r * cellH;
      // recessed glass pane
      const pg = new THREE.BoxGeometry(axis === 'x' ? paneW : 0.04, paneH, axis === 'x' ? 0.04 : paneW);
      pg.translate(axis === 'x' ? cx : gz, cy, axis === 'x' ? gz : cx);
      G.push(pg);
      // mullion cross (vertical + horizontal bar) framing the pane, proud of glass
      const vb = new THREE.BoxGeometry(axis === 'x' ? mullW : 0.05, paneH + 0.12, axis === 'x' ? 0.05 : mullW);
      vb.translate(axis === 'x' ? cx : mz, cy, axis === 'x' ? mz : cx);
      M.push(vb);
      const hb = new THREE.BoxGeometry(axis === 'x' ? paneW + 0.12 : 0.05, mullW, axis === 'x' ? 0.05 : paneW + 0.12);
      hb.translate(axis === 'x' ? cx : mz, cy, axis === 'x' ? mz : cx);
      M.push(hb);
    }
  }
}

function building(rng, { footprint = 14, floors = 8, facade = 'concrete' } = {}) {
  const g = new THREE.Group();
  const storeyH = 3.4;                       // ~3.4 m per floor (real)
  const setbackEvery = 3 + Math.floor(rng() * 3); // step in every 3-5 floors
  const setbackAmt = 0.12;                    // fraction of footprint shed per setback

  let w = footprint, d = footprint * (0.8 + rng() * 0.4);
  let y = 0;
  const glassMat = 'glass-clear';
  const trimMat = facade === 'concrete' ? 'ceramic-white' : 'concrete';
  // Merge-buckets: same-material small parts (window panes, mullions) collected
  // here per storey and merged into ONE geometry per material at the end so a
  // fully-fenestrated tower is ~4 meshes, not 400 (instancing-equivalent cost).
  const parts = { __dx: w, __dz: d };

  for (let f = 0; f < floors; f++) {
    // storey core slab (the solid wall mass behind the windows)
    const core = place(box(w, storeyH, d, facade), 0, y + storeyH / 2, 0);
    g.add(core);
    // recessed WINDOW GRID with mullions on all four faces (depth + reveal)
    parts.__dx = w; parts.__dz = d;
    const yMid = y + storeyH / 2;
    windowGridFace(parts, { w, h: storeyH, yMid, faceSign: +1, axis: 'x', glassMat, mullMat: trimMat });
    windowGridFace(parts, { w, h: storeyH, yMid, faceSign: -1, axis: 'x', glassMat, mullMat: trimMat });
    windowGridFace(parts, { w: d, h: storeyH, yMid, faceSign: +1, axis: 'z', glassMat, mullMat: trimMat });
    windowGridFace(parts, { w: d, h: storeyH, yMid, faceSign: -1, axis: 'z', glassMat, mullMat: trimMat });
    // CORNICE / floor-line LEDGE between storeys — a proud horizontal band that
    // throws a hard shadow-line (the strongest "real building" depth cue).
    g.add(place(box(w + 0.18, 0.14, d + 0.18, trimMat), 0, y + storeyH - 0.05, 0));
    // thin spandrel reveal just under the cornice for a layered façade.
    g.add(place(box(w + 0.06, 0.05, d + 0.06, facade), 0, y + storeyH - 0.22, 0));

    y += storeyH;
    // setback: shed footprint, recentre, leave a terrace lip
    if ((f + 1) % setbackEvery === 0 && f < floors - 1) {
      const nw = w * (1 - setbackAmt), nd = d * (1 - setbackAmt);
      g.add(place(box(w + 0.3, 0.18, d + 0.3, trimMat), 0, y + 0.09, 0)); // terrace deck + lip
      w = nw; d = nd;
    }
  }

  // Merge the window panes + mullions (one mesh per material) and emit them as
  // first-class tagged parts so the path tracer shades real recessed glass.
  for (const mat of Object.keys(parts)) {
    if (mat.startsWith('__')) continue;
    const geos = parts[mat];
    if (!geos || !geos.length) continue;
    try {
      const merged = BufferGeometryUtils.mergeGeometries(geos, false);
      if (merged) {
        const m = new THREE.Mesh(merged, matFor(mat));
        m.userData.studioMaterial = mat;
        g.add(m);
      }
    } catch (_) { /* skip merge on failure — core walls still read */ }
    for (const gg of geos) gg.dispose?.();
  }

  // ── parapet ring around the roof
  const para = 0.5;
  g.add(place(box(w + 0.1, para, 0.12, trimMat), 0, y + para / 2, d / 2));
  g.add(place(box(w + 0.1, para, 0.12, trimMat), 0, y + para / 2, -d / 2));
  g.add(place(box(0.12, para, d + 0.1, trimMat), w / 2, y + para / 2, 0));
  g.add(place(box(0.12, para, d + 0.1, trimMat), -w / 2, y + para / 2, 0));

  // ── ROOFTOP UNITS — AC condensers, a cylindrical water tank, a stair/lift
  //    bulkhead, a couple of vents. Placed on the roof deck.
  // bulkhead (stair/lift overrun)
  const bw = w * 0.3, bd = d * 0.28, bh = 2.4;
  g.add(place(box(bw, bh, bd, facade), -w * 0.18, y + bh / 2, -d * 0.12));
  // AC condenser units
  const nAC = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < nAC; i++) {
    const u = place(box(1.2, 0.9, 1.0, 'steel-brushed'),
      (rng() - 0.5) * w * 0.6 + w * 0.12, y + 0.45, (rng() - 0.5) * d * 0.6 + d * 0.12);
    g.add(u);
  }
  // cylindrical water tank on a short stand
  const tank = place(cyl(1.1, 1.1, 1.8, 'ceramic-white'), w * 0.22, y + 1.3, -d * 0.2);
  g.add(tank);
  g.add(place(cyl(0.06, 0.06, 0.5, 'steel-brushed'), w * 0.22 - 0.6, y + 0.25, -d * 0.2));
  g.add(place(cyl(0.06, 0.06, 0.5, 'steel-brushed'), w * 0.22 + 0.6, y + 0.25, -d * 0.2));
  // a couple of roof vents
  for (let i = 0; i < 2; i++) g.add(place(cyl(0.18, 0.22, 0.4, 'steel-brushed'),
    (rng() - 0.5) * w * 0.5, y + 0.2, (rng() - 0.5) * d * 0.5));
  // parapet COPING cap (a flat lighter band on top of the parapet ring) + a
  // thin roof railing run + an antenna mast — extra rooftop silhouette greeble
  // that reads against the sky in a skyline shot (Video-229 cue).
  g.add(place(box(w + 0.16, 0.06, 0.16, 'ceramic-white'), 0, y + para + 0.03, d / 2));
  g.add(place(box(w + 0.16, 0.06, 0.16, 'ceramic-white'), 0, y + para + 0.03, -d / 2));
  for (let i = 0; i < 4; i++) g.add(place(cyl(0.02, 0.02, 0.6, 'steel-brushed', 6), (-0.4 + i * 0.27) * w, y + 0.3, d * 0.32));
  g.add(place(box(w * 0.8, 0.03, 0.03, 'steel-brushed'), 0, y + 0.6, d * 0.32));      // railing top rail
  if (rng() > 0.45) { // antenna mast on taller towers
    g.add(place(cyl(0.05, 0.07, 3.2 + rng() * 2, 'steel-brushed', 8), w * 0.22, y + 1.8, d * 0.18));
  }

  // ground-floor entrance canopy (glass + steel) on the +Z (street) face + a
  // pair of entry columns + a cantilever lip for street-level depth.
  g.add(place(box(w * 0.5, 0.12, 1.6, glassMat), 0, storeyH * 0.9, d / 2 + 0.8));
  g.add(place(box(w * 0.5, storeyH * 0.85, 0.1, glassMat), 0, storeyH * 0.42, d / 2 + 0.02)); // lobby glazing
  for (const sx of [-1, 1]) g.add(place(cyl(0.12, 0.12, storeyH * 0.9, trimMat, 12), sx * w * 0.22, storeyH * 0.45, d / 2 + 0.78)); // canopy columns
  g.add(place(box(w * 0.56, 0.08, 0.3, trimMat), 0, storeyH * 0.96, d / 2 + 1.55)); // canopy front lip

  g.userData.__cityHeight = y;
  g.userData.__cityFoot = [w, d];
  return g;
}

// ── LAMP POST — base + pole + horizontal arm + luminaire head. ───────────────
function lampPost(rng) {
  const g = new THREE.Group();
  const H = 5.2;
  g.add(place(cyl(0.18, 0.22, 0.3, 'concrete'), 0, 0.15, 0));        // footing
  g.add(place(cyl(0.07, 0.09, H, 'steel-brushed'), 0, H / 2, 0));     // pole
  g.add(place(box(1.1, 0.08, 0.08, 'steel-brushed'), 0.5, H - 0.1, 0)); // arm
  g.add(place(box(0.5, 0.18, 0.26, 'ceramic-white'), 1.0, H - 0.18, 0)); // luminaire head
  return g;
}

// ── BENCH — slatted seat + back on two end frames. ───────────────────────────
function bench(rng) {
  const g = new THREE.Group();
  const w = 1.8, seatH = 0.45;
  for (let i = 0; i < 4; i++) g.add(place(box(w, 0.05, 0.1, 'wood-oak'), 0, seatH, -0.18 + i * 0.12)); // seat slats
  for (let i = 0; i < 3; i++) g.add(place(box(w, 0.05, 0.07, 'wood-oak'), 0, seatH + 0.18 + i * 0.14, -0.28)); // back slats
  for (const sx of [-1, 1]) {                                          // cast frames
    g.add(place(box(0.08, seatH, 0.5, 'cast-iron'), sx * (w / 2 - 0.1), seatH / 2, 0));
    g.add(place(box(0.08, 0.55, 0.08, 'cast-iron'), sx * (w / 2 - 0.1), seatH + 0.27, -0.28));
  }
  return g;
}

// ── CAR — boxy body + cabin greenhouse + four wheels (rubber) + glazing. ─────
function car(rng) {
  const g = new THREE.Group();
  const bodyMats = ['steel-brushed', 'steel-polished', 'plastic-matte', 'cast-iron'];
  const bodyMat = bodyMats[Math.floor(rng() * bodyMats.length)];
  const L = 4.3, W = 1.85, bodyH = 0.7, wheelR = 0.34;
  g.add(place(box(W, bodyH, L, bodyMat), 0, wheelR + bodyH / 2, 0));              // lower body
  g.add(place(box(W * 0.92, 0.62, L * 0.5, bodyMat), 0, wheelR + bodyH + 0.30, -0.1)); // cabin
  g.add(place(box(W * 0.86, 0.46, L * 0.5 - 0.04, 'glass-clear'), 0, wheelR + bodyH + 0.30, -0.1)); // greenhouse glass
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {                            // wheels
    const wseg = cyl(wheelR, wheelR, 0.22, 'rubber-black', 16);
    wseg.rotation.z = Math.PI / 2;
    g.add(place(wseg, sx * (W / 2 - 0.05), wheelR, sz * (L / 2 - 0.85)));
  }
  return g;
}

// ── TREE — trunk + 2-3 stacked canopy spheres (the "plant builder" form). ────
function tree(rng) {
  const g = new THREE.Group();
  const h = 2.4 + rng() * 1.6;
  g.add(place(cyl(0.12, 0.18, h, 'wood-walnut', 10), 0, h / 2, 0));       // trunk
  const layers = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < layers; i++) {
    const cr = 1.2 - i * 0.28 + rng() * 0.2;
    const cy = h + 0.2 + i * 0.9;
    const c = ball(cr, 'fabric-grey', 14);                                 // canopy (green-ish via grey base; albedo scan recolours)
    c.userData.studioMaterial = 'velvet';                                  // muted leaf tone in the registry palette
    place(c, (rng() - 0.5) * 0.3, cy, (rng() - 0.5) * 0.3);
    g.add(c);
  }
  return g;
}

// ── PLANTER — a low concrete box with a clipped hedge (street-level greening). ─
function planter(rng) {
  const g = new THREE.Group();
  g.add(place(box(1.4, 0.5, 0.7, 'concrete'), 0, 0.25, 0));
  const hedge = box(1.2, 0.5, 0.55, 'velvet'); hedge.userData.studioMaterial = 'velvet';
  g.add(place(hedge, 0, 0.72, 0));
  return g;
}

// ── TRAFFIC LIGHT / SIGN POST — pole + horizontal mast + signal head + sign. ──
function trafficLight(rng) {
  const g = new THREE.Group();
  const H = 5.6;
  g.add(place(cyl(0.1, 0.13, H, 'cast-iron', 10), 0, H / 2, 0));
  g.add(place(box(0.08, 0.08, 3.0, 'cast-iron'), 0, H - 0.2, 1.5));   // mast over carriageway
  g.add(place(box(0.32, 0.9, 0.3, 'plastic-matte'), 0, H - 0.4, 2.8)); // signal head
  g.add(place(box(0.9, 0.55, 0.04, 'ceramic-white'), 0, H * 0.55, 0.2)); // street sign blade
  return g;
}

// ── DISTANT SKYLINE BACKDROP — a deep ring of simplified extruded towers far
//    behind the street, receding in rows, that gives the SKYLINE DEPTH + haze
//    read of Video-229. These are pure silhouette mass (no windows) so the depth
//    cost is tiny; the HDRI sky + the PT's atmospheric falloff do the haze. They
//    sit OUTSIDE the walkable grid so they never collide with the foreground.
function buildSkyline(scene, rng, innerHalf) {
  const ringCount = 3;                     // rows of distant towers, receding
  let towers = 0;
  for (let ring = 0; ring < ringCount; ring++) {
    const dist = innerHalf + 70 + ring * 95;        // metres out from centre
    const perSide = 10 + ring * 3;
    for (let side = 0; side < 4; side++) {           // N/E/S/W belts
      for (let k = 0; k < perSide; k++) {
        const t = (k / (perSide - 1) - 0.5) * 2;     // -1..1 along the belt
        const along = t * dist * 1.25;
        let x, z;
        if (side === 0) { x = along; z = dist; }
        else if (side === 1) { x = along; z = -dist; }
        else if (side === 2) { x = dist; z = along; }
        else { x = -dist; z = along; }
        const h = 28 + rng() * (70 + ring * 30);     // taller the farther back
        const fw = 9 + rng() * 12, fd = 9 + rng() * 12;
        const jx = x + (rng() - 0.5) * 30, jz = z + (rng() - 0.5) * 30;
        const m = box(fw, h, fd, FACADE_MATS[Math.floor(rng() * FACADE_MATS.length)], false);
        place(m, jx, h / 2, jz);
        emitMesh(scene, m);
        // a slim rooftop block so the far silhouette isn't a flat row of caps
        if (rng() > 0.5) { const cap = box(fw * 0.3, 3 + rng() * 6, fd * 0.3, 'concrete', false); place(cap, jx, h + 2, jz); emitMesh(scene, cap); }
        towers++;
      }
    }
  }
  return towers;
}

// ─────────────────────────────────────────────────────────────────────────────
//  bake + emit — collect every mesh in a placed group, bake its world transform
//  into geometry, detach to the scene root as a flat tagged/materialed primitive.
//  (Identical contract to sceneComposer.addJittered, minus the jitter, plus an
//  explicit world transform applied to the group first.)
// ─────────────────────────────────────────────────────────────────────────────
function emit(scene, group, x, z, ry = 0, scale = 1) {
  group.position.set(x, group.position.y, z);
  group.rotation.y = ry;
  if (scale !== 1) group.scale.setScalar(scale);
  group.updateMatrixWorld(true);
  const meshes = [];
  group.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    o.updateWorldMatrix(true, false);
    o.geometry.applyMatrix4(o.matrixWorld);
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.matrix.identity();
    o.userData.archdiscStudioPrimitive = true;
    o.userData.archdiscStudioCity = true;
    o.castShadow = true; o.receiveShadow = true;
    scene.add(o);
  }
  return meshes.length;
}

// Emit a REAL (downloaded CC0 glb) group: clone-bake each mesh into the scene
// root EXACTLY like emit(), but PRESERVE the real glTF PBR material by tagging
// archdiscRealMaterial (so the path tracer keeps the model's own material instead
// of synthesizing one from a studioMaterial registry id). The group has already
// been scaled + positioned by the caller. Returns the mesh count.
function emitReal(scene, group, x, z, ry = 0) {
  group.position.set(x, group.position.y, z);
  group.rotation.y = ry;
  group.updateMatrixWorld(true);
  const meshes = [];
  group.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    o.updateWorldMatrix(true, false);
    o.geometry = o.geometry.clone();           // don't bake into the shared master geometry
    o.geometry.applyMatrix4(o.matrixWorld);
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.matrix.identity();
    o.userData.archdiscStudioPrimitive = true;  // → harvested by harvestScene + body count
    o.userData.archdiscRealMaterial = true;     // → keep the real glTF PBR material
    o.userData.archdiscStudioCity = true;       // → swept on the next city rebuild
    o.castShadow = true; o.receiveShadow = true;
    scene.add(o);
  }
  return meshes.length;
}

// Load + cache a prop master, ground it on y=0, centre its XZ footprint, and
// uniformly scale it to its registry target size — returns a pristine, correctly
// sized prototype that callers CLONE per placement (load once, instance many).
const _cityProtoCache = {};
async function cityPrototype(id) {
  if (_cityProtoCache[id]) return _cityProtoCache[id];
  const master = await loadPropMaster(id);          // tagged + cached in realCharacter
  const proto = master.clone(true);
  scaleToTarget(proto, PROP_MAP[id]);               // Kenney kit unit-scale → real metres
  // ground on y=0 + centre XZ so a placement at (x,z) sits the model on the road.
  proto.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(proto);
  const c = box.getCenter(new THREE.Vector3());
  proto.position.x -= c.x; proto.position.z -= c.z; proto.position.y -= box.min.y;
  proto.updateMatrixWorld(true);
  _cityProtoCache[id] = proto;
  return proto;
}

// Emit a single already-positioned mesh (ground / road / markings) flat.
function emitMesh(scene, mesh) {
  mesh.updateWorldMatrix(true, false);
  mesh.geometry.applyMatrix4(mesh.matrixWorld);
  mesh.position.set(0, 0, 0); mesh.rotation.set(0, 0, 0); mesh.scale.set(1, 1, 1); mesh.matrix.identity();
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioCity = true;
  mesh.castShadow = false; mesh.receiveShadow = true;
  scene.add(mesh);
}

// ─────────────────────────────────────────────────────────────────────────────
//  GROUND + STREETS — one big asphalt ground spanning the grid, a raised
//  concrete sidewalk ring per block, painted lane dashes down the carriageway
//  centre + a zebra crossing. The street runs along +Z (the humanoid's forward
//  travel axis in humanoidLocomotion), centred on x=0.
// ─────────────────────────────────────────────────────────────────────────────
function buildGroundAndStreets(scene, blocks) {
  const span = blocks * CELL + ROAD_W + 2 * SIDEWALK_W;
  // asphalt ground (whole site) — real CC0 asphalt PBR scan (ambientCG Road007).
  emitMesh(scene, place(slab(span, 0.04, span, 'asphalt'), 0, -0.02, 0));

  // the central carriageway runs along Z; sidewalks flank it.
  const roadLen = span;
  // sidewalks (raised concrete) on both sides of the carriageway
  const swCx = ROAD_W / 2 + SIDEWALK_W / 2;
  for (const sx of [-1, 1]) {
    emitMesh(scene, place(slab(SIDEWALK_W, CURB_H, roadLen, 'sidewalk'), sx * swCx, CURB_H / 2, 0));
    // curb lip
    emitMesh(scene, place(slab(0.12, CURB_H + 0.04, roadLen, 'ceramic-white'), sx * (ROAD_W / 2 + 0.06), (CURB_H + 0.04) / 2, 0));
  }

  // lane markings — dashed centre line down the carriageway
  const dashLen = 1.2, gap = 1.2;
  const n = Math.floor(roadLen / (dashLen + gap));
  for (let i = 0; i < n; i++) {
    const z = -roadLen / 2 + (i + 0.5) * (dashLen + gap);
    emitMesh(scene, place(slab(0.15, 0.012, dashLen, 'ceramic-white'), 0, 0.012, z));
  }
  // edge lines (solid) at the lane/sidewalk boundary
  for (const sx of [-1, 1]) emitMesh(scene, place(slab(0.1, 0.012, roadLen, 'ceramic-white'), sx * (ROAD_W / 2 - 0.4), 0.012, 0));

  // a zebra crossing near origin (across the carriageway, X-wise stripes)
  const zN = 6;
  for (let i = 0; i < zN; i++) {
    const x = -ROAD_W / 2 + 0.8 + i * ((ROAD_W - 1.6) / (zN - 1));
    emitMesh(scene, place(slab(0.45, 0.014, 3.0, 'ceramic-white'), x, 0.014, 4.0));
  }
  return { span, roadLen };
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC: build the city.
// ─────────────────────────────────────────────────────────────────────────────
function getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

export async function buildCity({ blocks = 2, seed = 7, scene = null, skyline = true, realCars = true, realTrees = true, realBuildings = true } = {}) {
  scene = scene || getScene();
  if (!scene) return { ok: false, error: 'buildCity: no scene' };
  const nBlocks = Math.max(1, Math.min(4, Math.floor(blocks)));
  const rng = makeRng(seed);

  // Pre-load the REAL CC0 vehicle + tree prototypes ONCE (cached + cloned per
  // placement). If a download is missing/unreachable the load throws → we fall
  // back to the procedural car()/tree() for that family and record the reason in
  // the result (no silent half-build). The whole city still renders either way.
  let vehicleProtos = [], treeProtos = [], assetNote = null;
  if (realCars) {
    try { vehicleProtos = await Promise.all(VEHICLE_ASSETS.map((id) => cityPrototype(id).then((p) => ({ id, p })))); }
    catch (e) { vehicleProtos = []; assetNote = 'real vehicles unavailable (' + (e && e.message || e) + ') → procedural cars'; }
  }
  if (realTrees) {
    try { treeProtos = await Promise.all(TREE_ASSETS.map((id) => cityPrototype(id).then((p) => ({ id, p })))); }
    catch (e) { treeProtos = []; assetNote = (assetNote ? assetNote + '; ' : '') + 'real trees unavailable (' + (e && e.message || e) + ') → procedural trees'; }
  }
  // Pre-load the REAL B-rep BUILDING prototypes (Forge-OCCT generated glbs with
  // boolean-cut recessed window grids). Loaded ONCE + cloned per plot; if a load
  // fails we fall back to the procedural building() box and note the reason — the
  // city still renders fully either way.
  let buildingProtos = [];
  if (realBuildings) {
    try { buildingProtos = await Promise.all(BUILDING_ASSETS.map((id) => cityPrototype(id).then((p) => ({ id, p })))); }
    catch (e) { buildingProtos = []; assetNote = (assetNote ? assetNote + '; ' : '') + 'real B-rep buildings unavailable (' + (e && e.message || e) + ') → procedural buildings'; }
  }

  // clear any prior city prims (leave other primitives + humanoids alone unless
  // they're tagged city — a fresh build replaces the city only).
  const doomed = [];
  scene.traverse((o) => { if (o && o.userData && o.userData.archdiscStudioCity) doomed.push(o); });
  for (const o of doomed) { o.geometry?.dispose?.(); o.material?.dispose?.(); o.parent?.remove(o); }

  buildGroundAndStreets(scene, nBlocks);

  // Place buildings on the block interiors flanking the street. The street is
  // the central carriageway+sidewalks (width ROAD_W + 2*SIDEWALK_W) running on
  // Z; building plots sit at |x| beyond the sidewalk on each side, repeated
  // along Z for nBlocks rows.
  const plotCx = ROAD_W / 2 + SIDEWALK_W + PLOT / 2; // plot centre X off the street
  let buildings = 0, realBuildingPlaced = 0;
  let bi = 0;
  for (let row = 0; row < nBlocks; row++) {
    const cz = (-(nBlocks - 1) / 2 + row) * (PLOT + 6);
    for (const sx of [-1, 1]) {
      // Real B-rep towers are large hero solids (~16-20 m deep) → 1 per plot edge
      // so they don't overlap; the procedural boxes are smaller → 2 per edge.
      const nPer = buildingProtos.length ? 1 : 2;
      for (let b = 0; b < nPer; b++) {
        const bx = sx * (plotCx + (b - 0.5) * 0.0);
        const bz = cz + (nPer === 1 ? 0 : (b - 0.5) * (PLOT * 0.42));
        // face the building toward the street (buildings on +x face -x, -x face +x).
        const ry = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
        if (buildingProtos.length) {
          // REAL B-rep building glb (boolean-cut recessed windows) — round-robin
          // through the hero catalogue so the skyline reads varied + distinct.
          const sel = buildingProtos[bi % buildingProtos.length]; bi++;
          emitReal(scene, sel.p.clone(true), bx, bz, ry);
          realBuildingPlaced++;
        } else {
          const floors = 4 + Math.floor(rng() * 12);
          const foot = 9 + rng() * 7;
          const facade = FACADE_MATS[Math.floor(rng() * FACADE_MATS.length)];
          emit(scene, building(rng, { footprint: foot, floors, facade }), bx, bz, ry);
        }
        buildings++;
      }
    }
  }

  // ── street props — line the sidewalks: lamp posts / benches / trees /
  //    planters down both pavements, plus a few parked cars along the curb.
  const swX = ROAD_W / 2 + SIDEWALK_W * 0.55; // prop line on the pavement
  const propSpacing = 6.0;
  const half = (nBlocks * CELL) / 2;
  let props = 0, cars = 0, trees = 0;
  let realTreePlaced = 0, realCarPlaced = 0;
  for (const sx of [-1, 1]) {
    let k = 0;
    for (let z = -half; z <= half; z += propSpacing, k++) {
      const kind = k % 4;
      if (kind === 0) { emit(scene, lampPost(rng), sx * swX, z); props++; }
      else if (kind === 1) { emit(scene, bench(rng), sx * (swX - 0.3), z, sx > 0 ? Math.PI / 2 : -Math.PI / 2); props++; }
      else if (kind === 2) {
        // REAL CC0 tree glb (clone a prototype) on the curb-side of the pavement;
        // fall back to the procedural sphere-stack tree only if none loaded.
        if (treeProtos.length) {
          const sel = treeProtos[Math.floor(rng() * treeProtos.length)];
          emitReal(scene, sel.p.clone(true), sx * (swX + 0.4), z, rng() * Math.PI * 2);
          realTreePlaced++;
        } else {
          emit(scene, tree(rng), sx * (swX + 0.4), z);
        }
        trees++;
      }
      else { emit(scene, planter(rng), sx * (swX - 0.2), z, sx > 0 ? Math.PI / 2 : -Math.PI / 2); props++; }
    }
  }
  // traffic lights / sign posts at the corners (near the zebra crossing).
  for (const sx of [-1, 1]) { emit(scene, trafficLight(rng), sx * (ROAD_W / 2 + 0.4), 6.5, sx > 0 ? Math.PI : 0); props++; }
  // parked cars along the curb (just inside the carriageway edge), every other
  // gap, alternate facing.
  // Real CC0 vehicle glbs (sedan/SUV/van/truck) cloned + varied along the curb,
  // grounded on the carriageway, pointing along the street (local Z = length).
  // Falls back to the procedural boxy car() only if no vehicle glb loaded.
  const carX = ROAD_W / 2 - 1.1;
  let vi = 0;
  for (const sx of [-1, 1]) {
    for (let z = -half + 4; z <= half - 4; z += 11) {
      const ry = sx > 0 ? 0 : Math.PI;
      if (vehicleProtos.length) {
        const sel = vehicleProtos[vi % vehicleProtos.length]; vi++;   // round-robin model variety
        emitReal(scene, sel.p.clone(true), sx * carX, z, ry);
        realCarPlaced++;
      } else {
        emit(scene, car(rng), sx * carX, z, ry);
      }
      cars++;
    }
  }

  // ── distant SKYLINE backdrop (skyline depth + haze read, Video-229). Far
  //    outside the walkable grid; pure silhouette mass for cheap depth.
  let skylineTowers = 0;
  if (skyline) skylineTowers = buildSkyline(scene, rng, half);

  // body count
  let bodies = 0;
  scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) bodies++; });
  // triangle estimate over city prims
  let tris = 0;
  scene.traverse((o) => {
    if (!(o.isMesh && o.userData && o.userData.archdiscStudioCity)) return;
    const ix = o.geometry.index;
    if (ix) tris += ix.count / 3;
    else if (o.geometry.attributes.position) tris += o.geometry.attributes.position.count / 3;
  });

  return {
    ok: true,
    blocks: nBlocks,
    seed,
    buildings,
    props,
    cars,
    trees,
    realCars: realCarPlaced,
    realTrees: realTreePlaced,
    realBuildings: realBuildingPlaced,
    vehicleModels: vehicleProtos.map((v) => v.id),
    treeModels: treeProtos.map((v) => v.id),
    buildingModels: buildingProtos.map((v) => v.id),
    assetNote,
    skylineTowers,
    bodies,
    tris: Math.round(tris),
    streetAxis: 'z',
    roadWidth: ROAD_W,
    sidewalkWidth: SIDEWALK_W,
    span: nBlocks * CELL,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  install
// ─────────────────────────────────────────────────────────────────────────────
export function installCityBuilder() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  window.__studioBuildCity = (o) => buildCity(o || {});
  try {
    if (typeof window.__studioCommandRegister === 'function') {
      window.__studioCommandRegister('__studioBuildCity', window.__studioBuildCity, 'build',
        'Build a procedural walkable city block from primitives: asphalt streets + raised sidewalks + lane markings/zebra, a grid of varied window-banded setback buildings with rooftop units, lamp posts/benches/trees/cars — all tagged archdiscStudioPrimitive + materialed for the 4K PBR path tracer.');
    }
  } catch (_) { /* palette optional */ }
  return { ok: true };
}

export default installCityBuilder;
