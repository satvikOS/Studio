// ArchDisc Studio V3 — STUDIO FLAGSHIP #2: parametric procedural SPORTS CAR.
//
// window.__studioBuildVehicle(opts) builds a sleek, fully PARAMETRIC sports car
// in the LIVE viewport scene — PURE PROCEDURAL, NO imports (no glTF / scanned
// meshes). The defining feature is the BODY: it is NOT a box. The hull is a
// LOFTED SURFACE — a stack of closed cross-section PROFILE CURVES (one per
// station down the length: nose → bumper → cabin → tail) swept and skinned into
// one smooth, watertight shell. Each profile is a rounded-superellipse silhouette
// whose width/height/roundness/shoulder are interpolated station-to-station, so
// the surface flows continuously (cab-forward wedge, tumblehome cabin, haunched
// rear) the way a real car body does — with smooth (averaged) vertex normals for
// clean clearcoat reflections rather than the facet steps a box gives.
//
// On top of the hull: a GREENHOUSE (tinted glass cabin glazing lofted the same
// way, inset under the roofline), four WHEELS (rim hub + spokes + brake disc +
// rubber tyre with a sidewall), HEADLIGHTS + a continuous TAILLIGHT BAR (emissive
// — the Video-202 night-shot signature red strip), a GRILLE (chrome slats), wing
// MIRRORS, DOOR-LINE creases (a thin recessed feature line down the flank), and a
// flat UNDERBODY / diffuser. A front splitter + rear wing add the sports stance.
//
// PARAMETRIC: length / width / height / wheelbase / rideHeight / wheelCount /
// bodyStyle ('coupe' | 'roadster' | 'suv' | 'sedan'). Every dimension drives the
// loft stations + the running gear, so one builder spans a low coupe to a tall
// SUV. (wheelCount 4 default; 6 → a twin rear axle for a longer body.)
//
// MATERIAL TAGS (userData.studioMaterial → materialRegistry id, so the 4K PBR
// path tracer's realPbrSetCached / physMatFrom shade real surfaces, not clay):
//   body/wing/splitter/mirrors  → 'car-paint'  (metallic clearcoat)
//   greenhouse / windscreen     → 'glass'      (tinted, transmissive)
//   tyres                       → 'rubber'     (matte black)
//   grille / trim / exhaust /
//     rim spokes / door handles → 'chrome'     (mirror metal)
//   headlights                  → emissive cool-white panel
//   taillight bar               → emissive deep-red panel
//
// Each emitted mesh is tagged userData.archdiscStudioPrimitive (so the demo
// body-count + the path tracer's harvestScene pick it up) and re-parented FLAT to
// the scene root with its world transform baked into geometry — identical contract
// to cityBlock.emit / humanoid, so nothing is a hidden child the harvester skips.
//
// A DRIVE-PATH helper (window.__studioVehicleDriveFrame / driveVehicle) advances
// the car along a street SPLINE (a CatmullRom through waypoints, default the
// cityBlock carriageway down +Z): it positions + heads the body along the curve,
// SPINS the wheels by distance travelled, STEERS the front wheels toward the path
// tangent, and returns a chase/cinematic CAMERA SPEC so
// window.__studioRunPathTracedSequence({ poseFrame }) can animate the car through
// the city. The drive helper re-poses the LIVE meshes each frame; harvestScene
// re-bakes them, so the path-traced video sees the car mid-corner.
//
// Pure THREE (a v3 dep) + BufferGeometryUtils (already imported across v3) +
// materialRegistry. NO new npm packages. NO network. Loft + subdivision-quality
// smoothing are hand-written here.

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MATERIALS, resolveMaterial } from '../materialRegistry.js';

// ── scene access (live viewport, same convention as cityBlock / humanoid) ─────
function getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

// Deterministic RNG (LCG) — same form as cityBlock, so a seed reproduces a car.
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Live-viewport stand-in material from a registry id (the PT rebuilds the real
// MeshPhysicalMaterial from userData.studioMaterial at harvest; this is only what
// the raster viewport shows). Emissive ids are handled separately.
function matFor(id) {
  const m = resolveMaterial(id);
  return new THREE.MeshStandardMaterial({
    color: m.color,
    metalness: m.metalness ?? 0.0,
    roughness: m.roughness ?? 0.6,
    transparent: !!m.transmission,
    opacity: m.transmission ? 0.5 : 1.0,
  });
}
function emissiveMat(color, intensity) {
  return new THREE.MeshStandardMaterial({
    color: 0x111111, emissive: new THREE.Color(color), emissiveIntensity: intensity,
    metalness: 0.0, roughness: 0.4,
  });
}

// Tag + return a mesh with a registry material id.
function tagged(geom, id) {
  const m = new THREE.Mesh(geom, matFor(id));
  m.userData.studioMaterial = id;
  return m;
}
// Tag an EMISSIVE mesh — harvestScene keeps the live material when the mesh
// carries userData.archdiscRealMaterial (so the emissive lights survive into the
// path-traced frame instead of being replaced by a registry lookup).
function taggedEmissive(geom, color, intensity) {
  const m = new THREE.Mesh(geom, emissiveMat(color, intensity));
  m.userData.archdiscRealMaterial = true;   // preserve this emissive material at harvest
  m.userData.studioMaterial = 'plastic-matte';
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
//  BODY HULL — a LOFTED surface (the flagship feature; explicitly NOT a box).
//
//  We define a sequence of STATIONS down the car's length (−Z nose → +Z tail in
//  body-local space; +X right, +Y up). Each station has a closed cross-section
//  PROFILE: a rounded-superellipse ring (a smooth "tub" silhouette) parameterised
//  by halfWidth, floorY, roofY, a shoulder fraction (how high the widest point
//  sits), and a roundness exponent (corner sharpness). Interpolating the profile
//  parameters station-to-station and skinning consecutive rings into quads yields
//  ONE continuous smooth hull. Normals are averaged across shared ring vertices →
//  a glossy clearcoat surface with curvature continuity within each section.
// ─────────────────────────────────────────────────────────────────────────────

// One closed cross-section ring of `n` points for a station profile. The ring
// runs the full perimeter (right shoulder → roof centre → left shoulder → floor)
// as a rounded superellipse: x spans ±halfWidth, y spans floorY..roofY, with the
// widest point (the shoulder) at shoulderFrac of the height and `power` shaping
// the corner roundness (2 = ellipse, >2 = squarer/“shoulder line”).
function stationRing(n, { halfWidth, floorY, roofY, shoulderFrac = 0.62, power = 2.6, tumble = 0.12 }) {
  const pts = [];
  const midY = floorY + (roofY - floorY) * shoulderFrac;     // shoulder height
  const upH = roofY - midY;                                  // above shoulder
  const dnH = midY - floorY;                                 // below shoulder
  const inv = 2 / power;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;                         // 0..2π around the ring
    const cs = Math.cos(a), sn = Math.sin(a);
    // superellipse: |x|^p + |y|^p = 1 → sign-preserving power map.
    const sx = Math.sign(cs) * Math.pow(Math.abs(cs), inv);
    const sy = Math.sign(sn) * Math.pow(Math.abs(sn), inv);
    const x = sx * halfWidth;
    // upper half uses upH (roof), lower half uses dnH (floor) so the tub is taller
    // above the shoulder line than below — the real "greenhouse over body" stance.
    const y = midY + (sy >= 0 ? sy * upH : sy * dnH);
    // tumblehome: pull the roof inboard (narrower at the top) for a cabin taper.
    const tw = 1 - tumble * Math.max(0, sy);
    pts.push(new THREE.Vector3(x * tw, y, 0));
  }
  return pts;
}

// Smoothly interpolate a value across the station list using the station's t∈[0,1]
// position (already eased so the cabin/nose blend isn't linear-kinked).
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(t) { return t * t * (3 - 2 * t); }

// Build the lofted hull geometry from a station spec list. Each station: { z,
// halfWidth, floorY, roofY, shoulderFrac, power, tumble }. Returns an indexed,
// smooth-normal BufferGeometry (the outer body shell, capped at nose + tail).
function loftHull(stations, ringN) {
  const rings = stations.map((s) => stationRing(ringN, s).map((p) => new THREE.Vector3(p.x, p.y, s.z)));
  const positions = [];
  const indices = [];
  // vertices: ring after ring
  for (const ring of rings) for (const p of ring) positions.push(p.x, p.y, p.z);
  const ringStride = ringN;
  for (let s = 0; s < rings.length - 1; s++) {
    const base0 = s * ringStride;
    const base1 = (s + 1) * ringStride;
    for (let i = 0; i < ringN; i++) {
      const i2 = (i + 1) % ringN;
      const a = base0 + i, b = base0 + i2, c = base1 + i2, d = base1 + i;
      indices.push(a, b, d);   // two tris per quad, outward winding
      indices.push(b, c, d);
    }
  }
  // end caps (nose + tail) as triangle fans to the ring centroid so the hull is
  // closed (watertight) — the PT then reads a solid body, not a hollow tube.
  const addCap = (ringIndex, flip) => {
    const base = ringIndex * ringStride;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < ringN; i++) { cx += positions[(base + i) * 3]; cy += positions[(base + i) * 3 + 1]; cz += positions[(base + i) * 3 + 2]; }
    cx /= ringN; cy /= ringN; cz /= ringN;
    const ci = positions.length / 3;
    positions.push(cx, cy, cz);
    for (let i = 0; i < ringN; i++) {
      const i2 = (i + 1) % ringN;
      if (flip) indices.push(ci, base + i, base + i2);
      else indices.push(ci, base + i2, base + i);
    }
  };
  addCap(0, true);                 // nose cap
  addCap(rings.length - 1, false); // tail cap

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  // Weld then smooth-normal so shared ring edges average → continuous shading.
  const welded = BufferGeometryUtils.mergeVertices(g, 1e-4);
  welded.computeVertexNormals();
  g.dispose();
  return welded;
}

// Station LADDER for a given body style + dims. z runs −L/2 (nose) → +L/2 (tail).
// Returns { hull, glass, roofPeakZ, beltY } so the greenhouse + features key off
// the same loft. All values in METRES, body-local (origin at car centre, y=0 at
// the lowest body point; the whole car is later lifted by wheelRadius+rideHeight).
function bodyStations(P) {
  const { length: L, width: W, height: Hb, style } = P;
  const hw = W / 2;
  // style coefficients: roof height + how cab-forward + haunch
  const styleK = {
    coupe:    { roof: 0.92, cabZ: 0.10, haunch: 1.10, nose: 0.34, tail: 0.40, beltFrac: 0.60 },
    roadster: { roof: 0.70, cabZ: 0.18, haunch: 1.08, nose: 0.34, tail: 0.38, beltFrac: 0.66 },
    suv:      { roof: 1.18, cabZ: -0.02, haunch: 1.02, nose: 0.46, tail: 0.50, beltFrac: 0.52 },
    sedan:    { roof: 1.00, cabZ: 0.00, haunch: 1.05, nose: 0.40, tail: 0.46, beltFrac: 0.56 },
  }[style] || { roof: 0.92, cabZ: 0.10, haunch: 1.10, nose: 0.34, tail: 0.40, beltFrac: 0.60 };

  const floor = 0.0;
  const bodyTop = Hb * styleK.roof;             // peak body/roof height
  const beltY = Hb * styleK.beltFrac;           // shoulder/belt line height
  const noseTop = Hb * styleK.nose;             // low nose
  const tailTop = Hb * styleK.tail;             // tail deck height

  // z stations (fractions of L, −0.5 nose → +0.5 tail). Cab pushed by cabZ.
  // cz is a FRACTION of L (added to the other station fractions BEFORE the ×L in
  // S), so a cab-forward style nudges the cabin stations toward the nose without
  // overrunning the body envelope.
  const cz = styleK.cabZ;
  const S = (zf, opts) => ({ z: zf * L, ...opts });
  const stations = [
    // nose tip (narrow, low)
    S(-0.50, { halfWidth: hw * 0.42, floorY: floor + 0.06, roofY: noseTop,           shoulderFrac: 0.55, power: 2.4, tumble: 0.05 }),
    // front bumper / lights
    S(-0.44, { halfWidth: hw * 0.80, floorY: floor + 0.02, roofY: noseTop * 1.05,    shoulderFrac: 0.55, power: 2.8, tumble: 0.06 }),
    // front wheel arch shoulder
    S(-0.30, { halfWidth: hw * 1.00, floorY: floor,        roofY: beltY * 0.96,      shoulderFrac: 0.60, power: 3.0, tumble: 0.08 }),
    // base of windscreen (cowl)
    S(-0.14 + cz, { halfWidth: hw * 0.99, floorY: floor,   roofY: beltY * 1.02,      shoulderFrac: 0.62, power: 3.0, tumble: 0.10 }),
    // roof front (A-pillar top)
    S(-0.02 + cz, { halfWidth: hw * 0.92, floorY: floor,   roofY: bodyTop,           shoulderFrac: 0.66, power: 2.8, tumble: 0.16 }),
    // roof mid (cabin peak)
    S(0.10 + cz, { halfWidth: hw * 0.92,  floorY: floor,   roofY: bodyTop,           shoulderFrac: 0.66, power: 2.8, tumble: 0.16 }),
    // rear roof / C-pillar fastback
    S(0.22 + cz, { halfWidth: hw * 0.96,  floorY: floor,   roofY: bodyTop * 0.90,    shoulderFrac: 0.64, power: 2.9, tumble: 0.12 }),
    // rear haunch (widest — the muscular hip over the rear axle)
    S(0.34, { halfWidth: hw * styleK.haunch, floorY: floor, roofY: beltY * 1.06,     shoulderFrac: 0.60, power: 3.2, tumble: 0.07 }),
    // tail deck
    S(0.44, { halfWidth: hw * 0.86, floorY: floor + 0.02, roofY: tailTop,            shoulderFrac: 0.56, power: 3.0, tumble: 0.05 }),
    // tail end (cut-off, narrow)
    S(0.50, { halfWidth: hw * 0.58, floorY: floor + 0.08, roofY: tailTop * 0.92,     shoulderFrac: 0.54, power: 2.6, tumble: 0.04 }),
  ];
  return { stations, beltY, bodyTop, roofFrontZ: (-0.02 + cz) * L, roofRearZ: (0.22 + cz) * L, noseTop, tailTop };
}

// GREENHOUSE — the glazed cabin as its OWN lofted shell, inset just under the
// roofline between the cowl and the C-pillar, narrower than the body (so the body
// shoulder reads below it). Tinted transmissive glass.
function greenhouseStations(P, body) {
  const { width: W } = P;
  const hw = W / 2;
  const sill = body.beltY * 0.92;          // glass starts at the belt line
  const roof = body.bodyTop * 0.985;       // up to just under the roof
  const z0 = body.roofFrontZ - 0.02 * P.length;  // windscreen base
  const z1 = body.roofRearZ + 0.04 * P.length;   // backlight base
  const S = (z, hwf, roofY) => ({ z, halfWidth: hw * hwf, floorY: sill, roofY, shoulderFrac: 0.72, power: 2.4, tumble: 0.22 });
  return [
    S(z0,                 0.70, roof * 0.86),  // raked windscreen
    S(lerp(z0, z1, 0.30), 0.85, roof),         // A-pillar top
    S(lerp(z0, z1, 0.55), 0.86, roof),         // roof
    S(lerp(z0, z1, 0.80), 0.82, roof * 0.94),  // C-pillar
    S(z1,                 0.66, roof * 0.80),  // backlight
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
//  WHEEL — rim hub + spokes + brake disc + rubber tyre with sidewall. The wheel
//  is built in its OWN local frame (spin about local X), centred at origin, so the
//  drive helper can rotate each wheel group about X for spin + the front pair
//  about Y for steer. Returns a THREE.Group (NOT yet emitted) so the assembler can
//  position it; emit() bakes it flat.
// ─────────────────────────────────────────────────────────────────────────────
function buildWheel(P, rng) {
  const g = new THREE.Group();
  const R = P.wheelRadius;
  const tyreW = P.wheelWidth;
  const rimR = R * 0.62;                  // rim (inside the tyre)
  const seg = 28;
  // tyre — a torus-ish cylinder shell (outer tread) + sidewalls. We use a tube:
  // outer cylinder (tread) and a slightly smaller inner so it reads as a tyre, not
  // a solid disc. Axis along local X.
  const tread = tagged(new THREE.CylinderGeometry(R, R, tyreW, seg, 1, true), 'rubber');
  tread.geometry.rotateZ(Math.PI / 2);   // axis → X
  g.add(tread);
  // sidewalls (two annulus rings) to close the tyre faces between tread + rim.
  for (const sx of [-1, 1]) {
    const wall = tagged(new THREE.RingGeometry(rimR * 0.98, R, seg), 'rubber');
    wall.geometry.rotateY(Math.PI / 2);            // face ±X
    wall.position.x = sx * tyreW / 2;
    if (sx < 0) wall.geometry.scale(1, 1, -1);     // flip the back ring's winding
    g.add(wall);
  }
  // rim barrel (chrome) — a short cylinder just inside the tyre.
  const barrel = tagged(new THREE.CylinderGeometry(rimR, rimR, tyreW * 0.78, seg), 'chrome');
  barrel.geometry.rotateZ(Math.PI / 2);
  g.add(barrel);
  // brake disc (dark chrome) behind the spokes, slightly inboard.
  const disc = tagged(new THREE.CylinderGeometry(rimR * 0.74, rimR * 0.74, 0.03, seg), 'cast-iron');
  disc.geometry.rotateZ(Math.PI / 2);
  disc.position.x = -tyreW * 0.15;
  g.add(disc);
  // rim face hub + SPOKES (chrome) on the outer face (+X side, the visible side
  // for a right-hand wheel; mirror handled by group orientation).
  const faceX = tyreW * 0.30;
  const hub = tagged(new THREE.CylinderGeometry(rimR * 0.22, rimR * 0.22, 0.05, 16), 'chrome');
  hub.geometry.rotateZ(Math.PI / 2);
  hub.position.x = faceX;
  g.add(hub);
  const nSpokes = P.spokeCount;
  for (let i = 0; i < nSpokes; i++) {
    const a = (i / nSpokes) * Math.PI * 2;
    const spoke = tagged(new THREE.BoxGeometry(0.04, rimR * 0.92, P.spokeWidth), 'chrome');
    // place spoke from hub outward along the wheel face plane (Y/Z), at angle a.
    spoke.geometry.translate(0, rimR * 0.46, 0);
    spoke.geometry.rotateX(a);
    spoke.position.x = faceX - 0.005;
    g.add(spoke);
  }
  // a chrome centre cap nut
  const cap = tagged(new THREE.CylinderGeometry(rimR * 0.1, rimR * 0.1, 0.06, 12), 'chrome');
  cap.geometry.rotateZ(Math.PI / 2);
  cap.position.x = faceX + 0.02;
  g.add(cap);
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ASSEMBLE — build the whole car into a single Group in body-local space, then
//  the public builder emits it flat into the scene. The group keeps named handles
//  on userData (wheels, frontWheels) so the drive helper can spin/steer them
//  BEFORE the flat bake (the live-mesh drive path re-poses then re-emits/harvests).
// ─────────────────────────────────────────────────────────────────────────────
function assembleCar(P, rng) {
  const car = new THREE.Group();
  const body = bodyStations(P);

  // ── HULL (lofted body shell) ──
  const hullGeom = loftHull(body.stations, P.ringN);
  const hull = new THREE.Mesh(hullGeom, matFor('car-paint'));
  hull.userData.studioMaterial = 'car-paint';
  car.add(hull);

  // ── GREENHOUSE (lofted tinted glass cabin) ──
  const ghGeom = loftHull(greenhouseStations(P, body), Math.max(16, P.ringN - 8));
  const greenhouse = new THREE.Mesh(ghGeom, matFor('glass'));
  greenhouse.userData.studioMaterial = 'glass';
  car.add(greenhouse);

  const L = P.length, hw = P.width / 2;

  // ── DOOR-LINE CREASE — a thin recessed chrome feature line down each flank at
  //    the belt height (the body's strongest length-wise highlight line). Built as
  //    a slim box following the flank; sits just proud so the PT lays a bright edge.
  for (const sx of [-1, 1]) {
    const crease = tagged(new THREE.BoxGeometry(0.012, 0.035, L * 0.62), 'chrome');
    crease.position.set(sx * hw * 0.99, body.beltY * 0.88, L * 0.02);
    car.add(crease);
    // door cut shut-line (a thinner dark recess) defining the door panel
    const shut = tagged(new THREE.BoxGeometry(0.01, 0.5, 0.012), 'plastic-matte');
    shut.position.set(sx * hw * 0.99, body.beltY * 0.6, -L * 0.05);
    car.add(shut);
    const shut2 = tagged(new THREE.BoxGeometry(0.01, 0.5, 0.012), 'plastic-matte');
    shut2.position.set(sx * hw * 0.99, body.beltY * 0.6, L * 0.13);
    car.add(shut2);
    // flush door handle (chrome)
    const handle = tagged(new THREE.BoxGeometry(0.02, 0.05, 0.16), 'chrome');
    handle.position.set(sx * hw * 0.995, body.beltY * 0.78, L * 0.04);
    car.add(handle);
  }

  // ── GRILLE — chrome slats set into the nose (front face, −Z). A frame + N
  //    horizontal bars across a recessed dark intake.
  const grilleZ = -L * 0.47;
  const grilleW = P.width * 0.5, grilleH = body.noseTop * 0.6;
  const grilleBack = tagged(new THREE.BoxGeometry(grilleW, grilleH, 0.04), 'plastic-matte');
  grilleBack.position.set(0, body.noseTop * 0.5, grilleZ + 0.02);
  car.add(grilleBack);
  const nBars = 6;
  for (let i = 0; i < nBars; i++) {
    const y = body.noseTop * 0.5 - grilleH / 2 + (i + 0.5) * (grilleH / nBars);
    const bar = tagged(new THREE.BoxGeometry(grilleW, 0.018, 0.05), 'chrome');
    bar.position.set(0, y, grilleZ);
    car.add(bar);
  }
  // side air intakes (lower bumper) — two dark recesses
  for (const sx of [-1, 1]) {
    const intake = tagged(new THREE.BoxGeometry(P.width * 0.16, body.noseTop * 0.3, 0.05), 'plastic-matte');
    intake.position.set(sx * hw * 0.62, body.noseTop * 0.28, grilleZ + 0.01);
    car.add(intake);
  }

  // ── HEADLIGHTS — two emissive cool-white lens panels in the front fascia,
  //    swept back along the fender (the slim modern signature).
  for (const sx of [-1, 1]) {
    const hl = taggedEmissive(new THREE.BoxGeometry(P.width * 0.20, 0.08, 0.10), 0xf2f6ff, 2.6);
    hl.position.set(sx * hw * 0.66, body.noseTop * 0.78, -L * 0.455);
    car.add(hl);
    // a chrome bezel around it
    const bez = tagged(new THREE.BoxGeometry(P.width * 0.22, 0.1, 0.04), 'chrome');
    bez.position.set(sx * hw * 0.66, body.noseTop * 0.78, -L * 0.448);
    car.add(bez);
  }

  // ── TAILLIGHT BAR — the Video-202 signature: ONE continuous emissive deep-red
  //    strip across the full tail width, plus a thin under-glow reflector. This is
  //    the single strongest "night sports car" cue.
  const tailZ = L * 0.49;
  const bar = taggedEmissive(new THREE.BoxGeometry(P.width * 0.84, 0.07, 0.06), 0xff1422, 3.2);
  bar.position.set(0, body.tailTop * 0.74, tailZ);
  car.add(bar);
  // outboard tail clusters (slightly brighter) at each corner
  for (const sx of [-1, 1]) {
    const cl = taggedEmissive(new THREE.BoxGeometry(P.width * 0.16, 0.11, 0.07), 0xff2030, 3.6);
    cl.position.set(sx * hw * 0.7, body.tailTop * 0.72, tailZ);
    car.add(cl);
  }
  // dual chrome exhaust tips under the rear diffuser
  for (const sx of [-1, 1]) {
    const exh = tagged(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 16), 'chrome');
    exh.geometry.rotateX(Math.PI / 2);
    exh.position.set(sx * hw * 0.45, 0.06, tailZ + 0.02);
    car.add(exh);
  }

  // ── WING MIRRORS — a stalk + a car-paint housing on each door.
  for (const sx of [-1, 1]) {
    const stalk = tagged(new THREE.CylinderGeometry(0.012, 0.012, 0.10, 8), 'plastic-matte');
    stalk.geometry.rotateZ(Math.PI / 2);
    stalk.position.set(sx * (hw + 0.05), body.beltY * 1.02, -L * 0.10);
    car.add(stalk);
    const housing = tagged(new THREE.BoxGeometry(0.06, 0.08, 0.14), 'car-paint');
    housing.position.set(sx * (hw + 0.12), body.beltY * 1.05, -L * 0.10);
    car.add(housing);
    const glass = tagged(new THREE.BoxGeometry(0.02, 0.06, 0.11), 'glass');
    glass.position.set(sx * (hw + 0.155), body.beltY * 1.05, -L * 0.10);
    car.add(glass);
  }

  // ── AERO — front splitter + rear wing (car-paint with chrome end-plates) for
  //    the sports stance (coupe/roadster only; suv/sedan skip the wing).
  const splitter = tagged(new THREE.BoxGeometry(P.width * 0.92, 0.03, 0.22), 'car-paint');
  splitter.position.set(0, 0.04, -L * 0.49);
  car.add(splitter);
  if (P.style === 'coupe' || P.style === 'roadster') {
    const wingY = body.tailTop * 1.15, wingZ = L * 0.46;
    const wing = tagged(new THREE.BoxGeometry(P.width * 0.78, 0.03, 0.18), 'car-paint');
    wing.position.set(0, wingY, wingZ);
    wing.geometry.rotateX(-0.12);
    car.add(wing);
    for (const sx of [-1, 1]) {
      const plate = tagged(new THREE.BoxGeometry(0.02, 0.16, 0.20), 'chrome');
      plate.position.set(sx * P.width * 0.38, wingY - 0.06, wingZ);
      car.add(plate);
      const stand = tagged(new THREE.BoxGeometry(0.03, 0.12, 0.05), 'car-paint');
      stand.position.set(sx * P.width * 0.30, wingY - 0.08, wingZ);
      car.add(stand);
    }
  }

  // ── UNDERBODY — a flat dark floor pan + a rear DIFFUSER (angled fins) so the
  //    car reads solid from below and at the rear (no hollow tube).
  const pan = tagged(new THREE.BoxGeometry(P.width * 0.86, 0.04, L * 0.86), 'plastic-matte');
  pan.position.set(0, 0.03, 0);
  car.add(pan);
  for (let i = -2; i <= 2; i++) {
    const fin = tagged(new THREE.BoxGeometry(0.02, 0.12, 0.3), 'plastic-matte');
    fin.position.set(i * P.width * 0.16, 0.08, L * 0.44);
    fin.geometry.rotateX(0.3);
    car.add(fin);
  }

  // ── WHEELS + AXLES ──
  // Axle z positions: front + rear from wheelbase, plus a mid axle when
  // wheelCount === 6 (twin rear). Wheel arches are implicit in the hull haunches.
  const wbHalf = P.wheelbase / 2;
  const trackHalf = hw - P.wheelWidth * 0.5 - 0.02;   // sit inside the body width
  const wheelY = P.wheelRadius;                        // hub at radius above ground
  const axleZ = [];
  axleZ.push(-wbHalf);                                 // front
  if (P.wheelCount >= 6) axleZ.push(wbHalf * 0.2);     // mid
  axleZ.push(wbHalf);                                  // rear
  // distribute extra pairs if wheelCount is even > 4 (e.g. 6 → front+mid+rear)
  const wheels = [];
  const frontWheels = [];
  const spin = +P.wheelSpin || 0;     // roll angle (about wheel local X)
  const steer = +P.wheelSteer || 0;   // front-axle steer (about Y)
  for (let ai = 0; ai < axleZ.length; ai++) {
    const z = axleZ[ai];
    const isFront = ai === 0;
    for (const sx of [-1, 1]) {
      const w = buildWheel(P, rng);
      // a right wheel (sx>0) shows its spoke face outward (+X); mirror the left.
      if (sx < 0) w.scale.x = -1;
      w.position.set(sx * trackHalf, wheelY, z);
      // STEER the front pair about Y (before spin so the spin stays about the
      // wheel's own axle), then SPIN every wheel about its local X by roll angle.
      if (isFront && steer) w.rotation.y = steer;
      if (spin) w.rotateX(spin);
      w.userData.__isWheel = true;
      car.add(w);
      wheels.push(w);
      if (isFront) frontWheels.push(w);
    }
  }

  car.userData.__wheels = wheels;
  car.userData.__frontWheels = frontWheels;
  car.userData.__wheelRadius = P.wheelRadius;
  car.userData.__dims = { length: L, width: P.width, height: P.height, wheelbase: P.wheelbase };
  return car;
}

// ─────────────────────────────────────────────────────────────────────────────
//  bake + emit — collect every mesh in the assembled group, bake its world
//  transform into geometry, detach to the scene root as flat tagged primitives.
//  Identical contract to cityBlock.emit. Returns the flat mesh list (so the drive
//  helper / verify can act on them) + counts.
// ─────────────────────────────────────────────────────────────────────────────
function emit(scene, group, { x = 0, y = 0, z = 0, ry = 0 } = {}) {
  group.position.set(x, y, z);
  group.rotation.y = ry;
  group.updateMatrixWorld(true);
  const meshes = [];
  group.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    o.updateWorldMatrix(true, false);
    o.geometry.applyMatrix4(o.matrixWorld);
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.matrix.identity();
    o.userData.archdiscStudioPrimitive = true;
    o.userData.archdiscStudioVehicle = true;
    o.castShadow = true; o.receiveShadow = true;
    scene.add(o);
  }
  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC: build the vehicle.
// ─────────────────────────────────────────────────────────────────────────────
function resolveParams(opts = {}) {
  const style = opts.bodyStyle || opts.style || 'coupe';
  // style-aware defaults (a coupe is low+long; an suv is tall+boxy).
  const base = {
    coupe:    { length: 4.5, width: 1.95, height: 1.20, wheelbase: 2.65, rideHeight: 0.11, wheelRadius: 0.35 },
    roadster: { length: 4.3, width: 1.90, height: 1.15, wheelbase: 2.50, rideHeight: 0.11, wheelRadius: 0.34 },
    suv:      { length: 4.8, width: 2.00, height: 1.70, wheelbase: 2.85, rideHeight: 0.22, wheelRadius: 0.39 },
    sedan:    { length: 4.9, width: 1.90, height: 1.45, wheelbase: 2.90, rideHeight: 0.14, wheelRadius: 0.36 },
  }[style] || { length: 4.5, width: 1.95, height: 1.20, wheelbase: 2.65, rideHeight: 0.11, wheelRadius: 0.35 };

  const P = {
    style,
    length: +opts.length || base.length,
    width: +opts.width || base.width,
    height: +opts.height || base.height,
    wheelbase: +opts.wheelbase || base.wheelbase,
    rideHeight: opts.rideHeight != null ? +opts.rideHeight : base.rideHeight,
    wheelCount: opts.wheelCount ? Math.max(4, Math.min(6, opts.wheelCount | 0)) : 4,
    wheelRadius: opts.wheelRadius != null ? +opts.wheelRadius : base.wheelRadius,
    wheelWidth: opts.wheelWidth != null ? +opts.wheelWidth : 0.28,
    spokeCount: opts.spokeCount ? (opts.spokeCount | 0) : 5,
    spokeWidth: 0.07,
    ringN: opts.ringN ? Math.max(16, Math.min(64, opts.ringN | 0)) : 40,
    // wheel pose (driven by the drive-path helper; 0 for a static build).
    wheelSpin: opts.__wheelSpin != null ? +opts.__wheelSpin : 0,
    wheelSteer: opts.__wheelSteer != null ? +opts.__wheelSteer : 0,
  };
  // keep the wheelbase inside the body length, the wheel inside the height.
  P.wheelbase = Math.min(P.wheelbase, P.length * 0.72);
  P.wheelRadius = Math.min(P.wheelRadius, P.height * 0.42);
  return P;
}

export function buildVehicle(opts = {}) {
  const scene = opts.scene || getScene();
  if (!scene) return { ok: false, error: 'buildVehicle: no scene' };
  const rng = makeRng(opts.seed != null ? opts.seed : 11);
  const P = resolveParams(opts);

  // clear any prior vehicle prims (leave the city / humanoid alone).
  if (opts.replace !== false) {
    const doomed = [];
    scene.traverse((o) => { if (o && o.userData && o.userData.archdiscStudioVehicle) doomed.push(o); });
    for (const o of doomed) { o.geometry?.dispose?.(); o.material?.dispose?.(); o.parent?.remove(o); }
  }

  const car = assembleCar(P, rng);
  // lift the whole car so wheels sit on the ground: body y=0 is the lowest body
  // point; the wheels already sit at hub=wheelRadius, tyre bottom at y=0. The body
  // floor should clear the ground by rideHeight, so raise the BODY (not wheels)…
  // simplest: build wheels at ground already (done), lift body group by rideHeight
  // — but body + wheels are one group. Instead we lifted nothing; the hull floor
  // is at y=0 and the tyres' bottom is at 0 too. Add rideHeight as a body inset by
  // emitting the whole group at y = rideHeight, then dropping the wheels back down.
  // To keep wheels grounded while the body sits at rideHeight, we shift the body's
  // hull/feature meshes up by rideHeight in-group before bake:
  for (const o of car.children) {
    if (o.userData && o.userData.__isWheel) continue;   // wheels stay grounded
    o.position.y += P.rideHeight;
  }

  const pos = {
    x: opts.x != null ? +opts.x : 0,
    y: opts.y != null ? +opts.y : 0,
    z: opts.z != null ? +opts.z : 0,
    ry: opts.heading != null ? +opts.heading : (opts.ry != null ? +opts.ry : 0),
  };
  const meshes = emit(scene, car, pos);

  // counts
  let tris = 0;
  for (const o of meshes) {
    const ix = o.geometry.index;
    if (ix) tris += ix.count / 3;
    else if (o.geometry.attributes.position) tris += o.geometry.attributes.position.count / 3;
  }

  // record the live wheel meshes (post-bake, by tag) so the drive helper can spin
  // them. We re-find them: wheel meshes carry 'rubber'/'chrome'/'cast-iron' tags
  // but to identify the wheel SET we tag them during emit via a group id.
  const result = {
    ok: true,
    style: P.style,
    params: P,
    meshCount: meshes.length,
    triCount: Math.round(tris),
    dims: { length: P.length, width: P.width, height: P.height, wheelbase: P.wheelbase, rideHeight: P.rideHeight },
    wheelCount: P.wheelCount,
    position: pos,
  };
  if (typeof window !== 'undefined') window.__studioVehicleLast = result;
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DRIVE PATH — advance the car along a street SPLINE. Because emit() bakes the
//  car flat into world space, "driving" rebuilds the car each frame at the new
//  pose along the spline (cheap: ~one assembleCar per frame), spinning the wheels
//  by distance travelled and steering the front wheels toward the path tangent.
//  Returns a per-frame CAMERA SPEC for runStudioPathTracedSequence's poseFrame.
//
//  The spline defaults to the cityBlock carriageway centre line (down +Z, the
//  street axis cityBlock reports), so the car drives THROUGH the city.
// ─────────────────────────────────────────────────────────────────────────────
function defaultStreetPath(span = 120) {
  // a gentle S down the carriageway (right lane offset), so the car corners.
  const half = span / 2;
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(-2.2, 0, -half),
    new THREE.Vector3(-2.2, 0, -half * 0.5),
    new THREE.Vector3(-2.6, 0, -half * 0.15),
    new THREE.Vector3(-2.0, 0, half * 0.2),
    new THREE.Vector3(-2.4, 0, half * 0.6),
    new THREE.Vector3(-2.2, 0, half),
  ], false, 'catmullrom', 0.5);
}

// Build the spline from waypoints ([[x,z],…]) or use the default street path.
function pathFrom(opts = {}) {
  if (opts.curve && opts.curve.getPointAt) return opts.curve;
  if (Array.isArray(opts.waypoints) && opts.waypoints.length >= 2) {
    const pts = opts.waypoints.map((w) => new THREE.Vector3(w[0], 0, w[1] != null ? w[1] : w[2] || 0));
    return new THREE.CatmullRomCurve3(pts, !!opts.closed, 'catmullrom', 0.5);
  }
  return defaultStreetPath(opts.span || 120);
}

// Advance the car to fraction u∈[0,1] along the path. Rebuilds the car at the
// new pose (position on the curve + heading along the tangent), spins wheels by
// the arc-distance travelled, steers the front wheels by the heading delta, and
// returns a camera spec (chase / cinematic side) for the path tracer.
//
//   driveVehicleFrame({ u, frameCount?, params?, camera?:'chase'|'side'|'low' })
//
// NOTE: this rebuilds via buildVehicle each call so the FLAT (harvestable) meshes
// reflect the new pose; pass the same `params` every frame for a stable car.
let _driveState = null;
function driveVehicleFrame(opts = {}) {
  const scene = opts.scene || getScene();
  if (!scene) return { ok: false, error: 'driveVehicleFrame: no scene' };
  const curve = pathFrom(opts);
  const u = Math.max(0, Math.min(1, opts.u != null ? opts.u : 0));
  const total = curve.getLength();
  const params = opts.params || {};

  const p = curve.getPointAt(u);
  const tan = curve.getTangentAt(u).normalize();
  // heading: car nose points along +Z body-local by our station layout? Our hull
  // nose is at −Z and tail at +Z, so the car FORWARD is +Z body-local. The world
  // heading rotates +Z to the tangent: ry = atan2(tan.x, tan.z).
  const heading = Math.atan2(tan.x, tan.z);

  // distance travelled since last frame → wheel spin angle.
  const dist = u * total;
  const wheelRadius = (_driveState && _driveState.wheelRadius) || 0.35;
  const spin = -dist / wheelRadius;                 // radians (roll forward)

  // steer angle from the heading delta to the upcoming tangent (look-ahead).
  const ahead = curve.getTangentAt(Math.min(1, u + 0.02)).normalize();
  const aheadHeading = Math.atan2(ahead.x, ahead.z);
  let steer = aheadHeading - heading;
  while (steer > Math.PI) steer -= Math.PI * 2;
  while (steer < -Math.PI) steer += Math.PI * 2;
  steer = Math.max(-0.5, Math.min(0.5, steer));

  // Rebuild the car flat at this pose. We pass the spin/steer so assembleCar's
  // wheels are pre-rotated, then emit bakes them.
  const built = buildVehicle({
    ...params, scene,
    x: p.x, y: p.y, z: p.z, heading,
    __wheelSpin: spin, __wheelSteer: steer,
    replace: true,
  });
  _driveState = { wheelRadius: built.params ? built.params.wheelRadius : wheelRadius, dims: built.dims };

  // CAMERA SPEC for the path tracer. Chase: behind + above, looking at the car.
  const dims = built.dims || { length: 4.5 };
  const camMode = opts.camera || 'chase';
  let camPos, look;
  const fwd = new THREE.Vector3(tan.x, 0, tan.z).normalize();
  const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
  const carPos = new THREE.Vector3(p.x, p.y, p.z);
  const lookAtCar = carPos.clone().add(new THREE.Vector3(0, dims.height ? dims.height * 0.5 : 0.6, 0));
  if (camMode === 'side') {
    camPos = carPos.clone().add(right.clone().multiplyScalar(6)).add(new THREE.Vector3(0, 1.6, 0)).add(fwd.clone().multiplyScalar(1.5));
    look = lookAtCar;
  } else if (camMode === 'low') {
    camPos = carPos.clone().add(fwd.clone().multiplyScalar(-3.2)).add(right.clone().multiplyScalar(2.4)).add(new THREE.Vector3(0, 0.5, 0));
    look = lookAtCar;
  } else { // chase
    camPos = carPos.clone().add(fwd.clone().multiplyScalar(-6.5)).add(new THREE.Vector3(0, 2.4, 0));
    look = carPos.clone().add(fwd.clone().multiplyScalar(2)).add(new THREE.Vector3(0, 0.5, 0));
  }
  return {
    ok: true,
    u, heading, steer, spin, distance: dist,
    position: [carPos.x, carPos.y, carPos.z],
    meshCount: built.meshCount,
    triCount: built.triCount,
    // camera spec consumable by runStudioPathTracedSequence's poseFrame return.
    position_cam: [camPos.x, camPos.y, camPos.z],
    cameraSpec: {
      position: [camPos.x, camPos.y, camPos.z],
      lookAt: [look.x, look.y, look.z],
      fov: 40,
      fStop: 2.2,
    },
  };
}

// Convenience: a ready-made poseFrame for window.__studioRunPathTracedSequence —
// drives the car start→end across `frameCount` frames and returns each frame's
// camera spec. Pass to the sequence renderer as { poseFrame }.
function makeDrivePoseFrame(opts = {}) {
  return (i, n) => {
    const u = n > 1 ? i / (n - 1) : 0;
    const r = driveVehicleFrame({ ...opts, u });
    return r.cameraSpec;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  install
// ─────────────────────────────────────────────────────────────────────────────
export function installVehicleBuilder() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  window.__studioBuildVehicle = (o) => buildVehicle(o || {});
  window.__studioVehicleDriveFrame = (o) => driveVehicleFrame(o || {});
  window.__studioVehicleDrivePoseFrame = (o) => makeDrivePoseFrame(o || {});
  try {
    if (typeof window.__studioCommandRegister === 'function') {
      window.__studioCommandRegister('__studioBuildVehicle', window.__studioBuildVehicle, 'build',
        'Build a fully parametric procedural SPORTS CAR (lofted smooth body hull from profile curves, tinted glass greenhouse, spoked wheels + rubber tyres, emissive head/taillight bar, chrome grille/trim, mirrors, door creases, underbody) — tagged car-paint/glass/rubber/chrome for the 4K PBR path tracer. Params: length/width/height/wheelbase/rideHeight/wheelCount/bodyStyle.');
      window.__studioCommandRegister('__studioVehicleDriveFrame', window.__studioVehicleDriveFrame, 'animate',
        'Advance the sports car along a street spline (positions+heads the body, spins wheels, steers fronts) and return a chase/side/low camera spec — feed __studioVehicleDrivePoseFrame to __studioRunPathTracedSequence to animate the car through the city.');
    }
  } catch (_) { /* palette optional */ }
  return { ok: true };
}

export default installVehicleBuilder;
