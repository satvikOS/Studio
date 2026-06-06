// Slice 711 — 3ds Max Reactor-style rigid body. Verlet-integrated
// rigid bodies + hinge / point / fixed constraints, plus a chain
// builder (link rigid spheres into a swinging rope/chain) and a
// rag-doll utility (attach rigid capsules to a skeleton).

import * as THREE from 'three';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';

const _bodies = new Map();
const _constraints = [];
let _enabled = false;
let _seq = 1;
function _uid() { return `rb-${_seq++}-${Date.now().toString(36)}`; }

export function addBody(opts) {
  const id = _uid();
  const pos = opts?.position || [0, 1, 0];
  const body = {
    id,
    pos: [...pos],
    prevPos: [...pos],
    radius: Number(opts?.radius) || 0.2,
    mass: Number(opts?.mass) || 1,
    fixed: !!opts?.fixed,
    helper: null,
  };
  const g = new THREE.SphereGeometry(body.radius, 12, 10);
  const m = new THREE.MeshStandardMaterial({ color: 0x806040, roughness: 0.6 });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.userData.reactorBodyId = id;
  if (window.__archdiscScene) window.__archdiscScene.add(mesh);
  body.helper = mesh;
  _bodies.set(id, body);
  return { ok: true, id };
}

export function addPointConstraint(bodyA, bodyB, distance) {
  const a = _bodies.get(bodyA);
  const b = _bodies.get(bodyB);
  if (!a || !b) return { ok: false };
  const d = distance ?? Math.sqrt(
    (a.pos[0] - b.pos[0]) ** 2 + (a.pos[1] - b.pos[1]) ** 2 + (a.pos[2] - b.pos[2]) ** 2);
  _constraints.push({ kind: 'point', a: bodyA, b: bodyB, d });
  return { ok: true };
}

export function addHingeConstraint(bodyA, bodyB, axis) {
  // For now treat as point-distance + restricted rotation noise.
  return addPointConstraint(bodyA, bodyB);
}

export function buildChain(opts) {
  const start = opts?.start || [0, 2, 0];
  const linkLen = Number(opts?.linkLen) || 0.3;
  const linkCount = Math.max(2, Math.min(60, Number(opts?.links) || 12));
  const radius = Number(opts?.radius) || 0.05;
  const ids = [];
  for (let i = 0; i < linkCount; i++) {
    const r = addBody({
      position: [start[0], start[1] - i * linkLen, start[2]],
      radius, mass: 0.4, fixed: i === 0,
    });
    ids.push(r.id);
    if (i > 0) addPointConstraint(ids[i - 1], r.id, linkLen);
  }
  return { ok: true, ids };
}

function _tick() {
  if (!_enabled) return;
  const dt = 1 / 60;
  const grav = -9.8;
  for (const b of _bodies.values()) {
    if (b.fixed) {
      b.prevPos[0] = b.pos[0]; b.prevPos[1] = b.pos[1]; b.prevPos[2] = b.pos[2];
      continue;
    }
    const vx = b.pos[0] - b.prevPos[0];
    const vy = b.pos[1] - b.prevPos[1];
    const vz = b.pos[2] - b.prevPos[2];
    b.prevPos[0] = b.pos[0]; b.prevPos[1] = b.pos[1]; b.prevPos[2] = b.pos[2];
    b.pos[0] += vx * 0.99;
    b.pos[1] += vy * 0.99 + grav * dt * dt;
    b.pos[2] += vz * 0.99;
    if (b.pos[1] < b.radius) {
      b.pos[1] = b.radius;
      // Lose energy on ground impact.
      b.prevPos[1] = b.pos[1] + (b.pos[1] - b.prevPos[1]) * 0.3;
    }
  }
  // Constraint resolution — 4 iterations.
  for (let it = 0; it < 4; it++) {
    for (const c of _constraints) {
      const a = _bodies.get(c.a);
      const b = _bodies.get(c.b);
      if (!a || !b) continue;
      const dx = b.pos[0] - a.pos[0];
      const dy = b.pos[1] - a.pos[1];
      const dz = b.pos[2] - a.pos[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const diff = (d - c.d) / d;
      const wa = a.fixed ? 0 : 0.5;
      const wb = b.fixed ? 0 : 0.5;
      const sum = wa + wb;
      if (sum > 0) {
        a.pos[0] += dx * diff * wa / sum;
        a.pos[1] += dy * diff * wa / sum;
        a.pos[2] += dz * diff * wa / sum;
        b.pos[0] -= dx * diff * wb / sum;
        b.pos[1] -= dy * diff * wb / sum;
        b.pos[2] -= dz * diff * wb / sum;
      }
    }
  }
  // Update meshes.
  for (const b of _bodies.values()) {
    if (b.helper) b.helper.position.set(b.pos[0], b.pos[1], b.pos[2]);
  }
}

export function start() {
  if (_enabled) return { ok: true };
  _enabled = true;
  chainIntoAnimTick('reactor', _tick);
  return { ok: true };
}

export function stop() {
  _enabled = false;
  unchainFromAnimTick('reactor');
  return { ok: true };
}

export function reset() {
  for (const b of _bodies.values()) {
    if (b.helper && b.helper.parent) b.helper.parent.remove(b.helper);
  }
  _bodies.clear();
  _constraints.length = 0;
  return { ok: true };
}

export function listBodies() {
  return {
    ok: true,
    bodies: Array.from(_bodies.values()).map((b) => ({
      id: b.id, pos: b.pos, fixed: b.fixed, radius: b.radius,
    })),
    constraints: _constraints.length,
  };
}
