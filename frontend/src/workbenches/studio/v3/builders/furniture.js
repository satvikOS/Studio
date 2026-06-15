// Parametric Studio asset builders — capability roadmap pillar 1 (Studio side).
//
// Each builder returns an ORDERED list of part specs
//   { kind, scale:[sx,sy,sz] (world metres), pos:[x,y,z] (m), rot:[x,y,z] (rad) }
// that compose a recognisable, human-scale, floor-aligned object from the
// declared primitives. The runtime dispatch (spawnPrimitive in
// StudioShellV3 / api.js) maps an `asset.make-<name>` tool call OR a
// click-primitive id like "chair" to builder(params) → spawns each part
// (scale = size/PRIMITIVE_SIZE, position absolute). The SAME specs seed the
// training corpus (scripts/synth_studio_assets.py) so Archie learns to call
// the asset in one shot instead of emitting N raw primitives.
//
// SCAFFOLD: real parametric geometry, returning blockout-grade composed
// objects. Detailing (bevels, joinery, upholstery splits) is the W3-5
// follow-up inside each builder. Wiring into spawnPrimitive is the W1 task.

const D = (params, key, def) => (typeof params?.[key] === 'number' ? params[key] : def);

export function makeChair(p = {}) {
  const w = D(p, 'seat_w', 0.45), d = D(p, 'seat_d', 0.45), sh = D(p, 'seat_h', 0.45);
  const bh = D(p, 'back_h', 0.45), lt = 0.04;
  const seatT = 0.06, parts = [];
  // seat
  parts.push({ kind: 'cube', scale: [w, seatT, d], pos: [0, sh, 0], rot: [0, 0, 0] });
  // backrest
  parts.push({ kind: 'cube', scale: [w, bh, 0.05], pos: [0, sh + bh / 2, -d / 2 + 0.03], rot: [0, 0, 0] });
  // 4 legs
  for (const [lx, lz] of [[-w / 2 + lt, -d / 2 + lt], [w / 2 - lt, -d / 2 + lt], [-w / 2 + lt, d / 2 - lt], [w / 2 - lt, d / 2 - lt]]) {
    parts.push({ kind: 'cylinder', scale: [lt, sh, lt], pos: [lx, sh / 2, lz], rot: [0, 0, 0] });
  }
  return parts;
}

export function makeTable(p = {}) {
  const w = D(p, 'width', 1.4), d = D(p, 'depth', 0.8), h = D(p, 'height', 0.74), lt = 0.06;
  const topT = 0.05, parts = [];
  parts.push({ kind: 'cube', scale: [w, topT, d], pos: [0, h, 0], rot: [0, 0, 0] });
  for (const [lx, lz] of [[-w / 2 + lt, -d / 2 + lt], [w / 2 - lt, -d / 2 + lt], [-w / 2 + lt, d / 2 - lt], [w / 2 - lt, d / 2 - lt]]) {
    parts.push({ kind: 'cylinder', scale: [lt, h, lt], pos: [lx, h / 2, lz], rot: [0, 0, 0] });
  }
  return parts;
}

export function makeSofa(p = {}) {
  const w = D(p, 'width', 2.0), d = D(p, 'depth', 0.95), sh = D(p, 'seat_h', 0.42), ah = 0.6, at = 0.18;
  const parts = [];
  parts.push({ kind: 'cube', scale: [w, sh, d], pos: [0, sh / 2, 0], rot: [0, 0, 0] });          // base
  parts.push({ kind: 'cube', scale: [w, ah, 0.25], pos: [0, sh + ah / 2, -d / 2 + 0.12], rot: [0, 0, 0] }); // back
  parts.push({ kind: 'cube', scale: [at, ah, d], pos: [-w / 2 + at / 2, sh + ah / 2 - 0.1, 0], rot: [0, 0, 0] }); // arm L
  parts.push({ kind: 'cube', scale: [at, ah, d], pos: [w / 2 - at / 2, sh + ah / 2 - 0.1, 0], rot: [0, 0, 0] });  // arm R
  return parts;
}

export function makeShelf(p = {}) {
  const w = D(p, 'width', 0.9), h = D(p, 'height', 1.8), d = D(p, 'depth', 0.3), shelves = Math.max(2, D(p, 'shelves', 4) | 0);
  const t = 0.03, parts = [];
  parts.push({ kind: 'cube', scale: [t, h, d], pos: [-w / 2, h / 2, 0], rot: [0, 0, 0] }); // side L
  parts.push({ kind: 'cube', scale: [t, h, d], pos: [w / 2, h / 2, 0], rot: [0, 0, 0] });  // side R
  for (let i = 0; i < shelves; i++) {
    parts.push({ kind: 'cube', scale: [w, t, d], pos: [0, (i / (shelves - 1)) * (h - t) + t / 2, 0], rot: [0, 0, 0] });
  }
  return parts;
}

export const FURNITURE_BUILDERS = { chair: makeChair, table: makeTable, sofa: makeSofa, shelf: makeShelf };
