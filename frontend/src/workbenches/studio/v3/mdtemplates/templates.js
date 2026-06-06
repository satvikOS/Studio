// Slice 710 — Marvelous Designer pre-built clothing templates. Each
// template is a curated set of slice-705 garment patterns + seams
// wired to a canonical fitting around a HumanIK-style figure. Cuts
// most of the manual pattern-drawing work users do in MD.
//
// Provided: tShirt, longSleeveShirt, pants, dress, skirt, hoodie,
// vest, shorts.

import {
  createGarment, addPattern, addSeam, buildMesh, drape,
} from '../garment/pattern.js';

function _rect(w, h) { return [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]]; }
function _trap(wTop, wBot, h) { return [[-wBot / 2, 0], [wBot / 2, 0], [wTop / 2, h], [-wTop / 2, h]]; }

// T-shirt: front + back rectangle + 2 sleeves; seams along sides + shoulders + sleeves.
export function tShirt(opts) {
  const c = createGarment();
  const torsoW = Number(opts?.torsoWidth) || 0.7;
  const torsoH = Number(opts?.torsoHeight) || 0.95;
  const sleeveW = Number(opts?.sleeveWidth) || 0.3;
  const sleeveH = Number(opts?.sleeveHeight) || 0.4;
  const yBase = Number(opts?.yBase) || 0.85;
  const front = addPattern(c.id, { polygon2D: _rect(torsoW, torsoH), placement: [0, yBase, 0.15], normalAxis: 'z' });
  const back  = addPattern(c.id, { polygon2D: _rect(torsoW, torsoH), placement: [0, yBase, -0.15], normalAxis: 'z' });
  const lSleeve = addPattern(c.id, { polygon2D: _rect(sleeveW, sleeveH), placement: [-torsoW / 2 - 0.05, yBase + torsoH - sleeveH, 0], normalAxis: 'x' });
  const rSleeve = addPattern(c.id, { polygon2D: _rect(sleeveW, sleeveH), placement: [torsoW / 2 + 0.05, yBase + torsoH - sleeveH, 0], normalAxis: 'x' });
  // Side seams.
  addSeam(c.id, front.uuid, [1, 2], back.uuid, [0, 3]);   // right
  addSeam(c.id, front.uuid, [3, 0], back.uuid, [2, 1]);   // left
  // Shoulder seams.
  addSeam(c.id, front.uuid, [2, 3], back.uuid, [1, 0]);
  // Sleeve seams (to armhole top).
  addSeam(c.id, lSleeve.uuid, [3, 2], front.uuid, [3, 2]);
  addSeam(c.id, rSleeve.uuid, [3, 2], front.uuid, [2, 1]);
  const built = buildMesh(c.id);
  if (opts?.drape !== false) drape(c.id, { iterations: 8, gravity: -0.05 });
  return { ok: true, garmentId: c.id, meshUuid: built.uuid };
}

export function longSleeveShirt(opts) {
  return tShirt({ ...opts, sleeveHeight: (Number(opts?.sleeveHeight) || 0.8) });
}

export function pants(opts) {
  const c = createGarment();
  const waistW = Number(opts?.waistWidth) || 0.42;
  const hipW = Number(opts?.hipWidth) || 0.5;
  const ankleW = Number(opts?.ankleWidth) || 0.18;
  const legH = Number(opts?.legHeight) || 0.95;
  const waistY = Number(opts?.yBase) || 0.9;
  const lLeg = addPattern(c.id, { polygon2D: _trap(ankleW, hipW / 2, legH), placement: [-0.12, waistY - legH, 0.05], normalAxis: 'z' });
  const rLeg = addPattern(c.id, { polygon2D: _trap(ankleW, hipW / 2, legH), placement: [0.12, waistY - legH, 0.05], normalAxis: 'z' });
  // Crotch seam.
  addSeam(c.id, lLeg.uuid, [1, 2], rLeg.uuid, [0, 3]);
  const built = buildMesh(c.id);
  if (opts?.drape !== false) drape(c.id, { iterations: 8, gravity: -0.05 });
  return { ok: true, garmentId: c.id, meshUuid: built.uuid };
}

export function dress(opts) {
  const c = createGarment();
  const torsoW = Number(opts?.torsoWidth) || 0.7;
  const torsoH = Number(opts?.torsoHeight) || 0.5;
  const skirtTop = Number(opts?.skirtTopWidth) || torsoW;
  const skirtBot = Number(opts?.skirtBotWidth) || 1.4;
  const skirtH = Number(opts?.skirtHeight) || 0.8;
  const yBase = Number(opts?.yBase) || 1.0;
  // Top torso.
  const front = addPattern(c.id, { polygon2D: _rect(torsoW, torsoH), placement: [0, yBase, 0.15], normalAxis: 'z' });
  const back = addPattern(c.id, { polygon2D: _rect(torsoW, torsoH), placement: [0, yBase, -0.15], normalAxis: 'z' });
  // Skirt panels (trapezoid front + back).
  const sFront = addPattern(c.id, { polygon2D: _trap(skirtTop, skirtBot, skirtH), placement: [0, yBase - skirtH, 0.15], normalAxis: 'z' });
  const sBack = addPattern(c.id, { polygon2D: _trap(skirtTop, skirtBot, skirtH), placement: [0, yBase - skirtH, -0.15], normalAxis: 'z' });
  // Torso side seams.
  addSeam(c.id, front.uuid, [1, 2], back.uuid, [0, 3]);
  addSeam(c.id, front.uuid, [3, 0], back.uuid, [2, 1]);
  // Skirt side seams.
  addSeam(c.id, sFront.uuid, [1, 2], sBack.uuid, [0, 3]);
  addSeam(c.id, sFront.uuid, [3, 0], back.uuid, [2, 1]);
  // Torso-to-skirt waist seam.
  addSeam(c.id, front.uuid, [0, 1], sFront.uuid, [3, 2]);
  addSeam(c.id, back.uuid, [0, 1], sBack.uuid, [3, 2]);
  const built = buildMesh(c.id);
  if (opts?.drape !== false) drape(c.id, { iterations: 10, gravity: -0.06 });
  return { ok: true, garmentId: c.id, meshUuid: built.uuid };
}

export function skirt(opts) {
  const c = createGarment();
  const top = Number(opts?.topWidth) || 0.5;
  const bot = Number(opts?.botWidth) || 1.0;
  const h = Number(opts?.height) || 0.6;
  const yBase = Number(opts?.yBase) || 0.8;
  const f = addPattern(c.id, { polygon2D: _trap(top, bot, h), placement: [0, yBase - h, 0.12], normalAxis: 'z' });
  const b = addPattern(c.id, { polygon2D: _trap(top, bot, h), placement: [0, yBase - h, -0.12], normalAxis: 'z' });
  addSeam(c.id, f.uuid, [1, 2], b.uuid, [0, 3]);
  addSeam(c.id, f.uuid, [3, 0], b.uuid, [2, 1]);
  const built = buildMesh(c.id);
  if (opts?.drape !== false) drape(c.id, { iterations: 8, gravity: -0.05 });
  return { ok: true, garmentId: c.id, meshUuid: built.uuid };
}

export function hoodie(opts) {
  // Like long-sleeve shirt + a hood (extra triangular panel on the back).
  const o = { ...opts, sleeveHeight: 0.85 };
  const base = tShirt(o);
  // Add the hood pattern.
  if (!base.ok) return base;
  const garment = base.garmentId;
  const torsoW = Number(opts?.torsoWidth) || 0.7;
  const yBase = Number(opts?.yBase) || 0.85;
  const hoodH = 0.4;
  addPattern(garment, { polygon2D: [[-torsoW / 3, 0], [torsoW / 3, 0], [torsoW / 4, hoodH], [-torsoW / 4, hoodH]], placement: [0, yBase + 0.95, -0.18], normalAxis: 'z' });
  const rebuilt = buildMesh(garment);
  if (opts?.drape !== false) drape(garment, { iterations: 8, gravity: -0.05 });
  return { ok: true, garmentId: garment, meshUuid: rebuilt.uuid };
}

export function vest(opts) {
  return tShirt({ ...opts, sleeveHeight: 0.02, sleeveWidth: 0.02 });
}

export function shorts(opts) {
  return pants({ ...opts, legHeight: 0.4 });
}
