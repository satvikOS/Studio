// Slice 728 — Architecture engineering depth. Foundation footings,
// floor joists, roof rafters, wall studs. Each builds a parametric
// repeated framing system from a length+spacing+section pair.

import * as THREE from 'three';

function _block(w, h, d, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  return new THREE.Mesh(g, m);
}

export function footingsFromOutline(outline, opts) {
  const depth = Number(opts?.depth) || 0.6;
  const width = Number(opts?.width) || 0.4;
  const yBase = Number(opts?.yBase) ?? -depth / 2;
  const group = new THREE.Group();
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-6) continue;
    const mesh = _block(len, depth, width, 0x444444);
    mesh.position.set((a[0] + b[0]) / 2, yBase, (a[1] + b[1]) / 2);
    mesh.lookAt(b[0], yBase, b[1]);
    mesh.rotateY(Math.PI / 2);
    group.add(mesh);
  }
  group.name = 'arch-footings';
  if (window.__archdiscScene) window.__archdiscScene.add(group);
  return { ok: true, uuid: group.uuid };
}

export function joistFloor(opts) {
  const length = Number(opts?.length) || 4;
  const width = Number(opts?.width) || 6;
  const spacing = Number(opts?.spacing) || 0.4;
  const joistW = Number(opts?.joistWidth) || 0.05;
  const joistH = Number(opts?.joistHeight) || 0.2;
  const yBase = Number(opts?.yBase) || 0;
  const group = new THREE.Group();
  const count = Math.floor(width / spacing) + 1;
  for (let i = 0; i < count; i++) {
    const mesh = _block(length, joistH, joistW, 0xa67a4f);
    mesh.position.set(0, yBase, -width / 2 + i * spacing);
    group.add(mesh);
  }
  group.name = 'arch-joist-floor';
  if (window.__archdiscScene) window.__archdiscScene.add(group);
  return { ok: true, uuid: group.uuid, joistCount: count };
}

export function wallStuds(opts) {
  const length = Number(opts?.length) || 4;
  const height = Number(opts?.height) || 2.6;
  const spacing = Number(opts?.spacing) || 0.4;
  const studW = Number(opts?.studWidth) || 0.05;
  const studD = Number(opts?.studDepth) || 0.09;
  const group = new THREE.Group();
  const count = Math.floor(length / spacing) + 1;
  for (let i = 0; i < count; i++) {
    const mesh = _block(studW, height, studD, 0xa67a4f);
    mesh.position.set(-length / 2 + i * spacing, height / 2, 0);
    group.add(mesh);
  }
  // Top + bottom plates.
  const top = _block(length, studW, studD, 0xa67a4f);
  top.position.set(0, height - studW / 2, 0);
  group.add(top);
  const bot = _block(length, studW, studD, 0xa67a4f);
  bot.position.set(0, studW / 2, 0);
  group.add(bot);
  group.name = 'arch-wall-studs';
  if (window.__archdiscScene) window.__archdiscScene.add(group);
  return { ok: true, uuid: group.uuid, studCount: count };
}

export function roofRafters(opts) {
  const span = Number(opts?.span) || 6;
  const length = Number(opts?.length) || 4;
  const pitchAngle = Number(opts?.pitchAngle) || Math.PI / 8;
  const spacing = Number(opts?.spacing) || 0.5;
  const rafterW = Number(opts?.rafterWidth) || 0.05;
  const rafterH = Number(opts?.rafterHeight) || 0.15;
  const ridgeY = Number(opts?.ridgeY) || 3;
  const group = new THREE.Group();
  const count = Math.floor(length / spacing) + 1;
  const rafterLen = (span / 2) / Math.cos(pitchAngle);
  for (let i = 0; i < count; i++) {
    const x = -length / 2 + i * spacing;
    // Left side.
    const left = _block(rafterW, rafterH, rafterLen, 0xa67a4f);
    left.position.set(x, ridgeY - rafterLen * Math.sin(pitchAngle) / 2, -rafterLen * Math.cos(pitchAngle) / 2);
    left.rotateX(-Math.PI / 2 + pitchAngle);
    group.add(left);
    // Right side.
    const right = _block(rafterW, rafterH, rafterLen, 0xa67a4f);
    right.position.set(x, ridgeY - rafterLen * Math.sin(pitchAngle) / 2, rafterLen * Math.cos(pitchAngle) / 2);
    right.rotateX(Math.PI / 2 - pitchAngle);
    group.add(right);
  }
  group.name = 'arch-roof-rafters';
  if (window.__archdiscScene) window.__archdiscScene.add(group);
  return { ok: true, uuid: group.uuid, rafterPairs: count };
}
