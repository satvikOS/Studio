// Slice 700 — Houdini DOPs (Dynamic OPs) — rigid-body solver graph
// with constraints, forces, and per-frame stepping. Distinct from
// slice 633 physics (single global state): DOPs are graph-driven so
// the user can wire object → force → constraint → output.

import * as THREE from 'three';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';

const _state = {
  objects: [],          // { uuid, meshUuid, mass, restitution, vel, kinematic }
  forces: [],           // { uuid, kind, strength, direction, center?, falloff }
  constraints: [],      // { uuid, kind, aUuid, bUuid, distance? }
  ground: { y: 0, enabled: true, friction: 0.95 },
  running: false,
  lastTickMs: 0,
};

let _seq = 1;
function _uuid() { return `dop-${_seq++}-${Date.now().toString(36)}`; }

export function addObject(meshUuid, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh) return { ok: false, error: 'mesh not found' };
  mesh.geometry?.computeBoundingSphere?.();
  const r = mesh.geometry?.boundingSphere?.radius || 0.5;
  const uuid = _uuid();
  _state.objects.push({
    uuid, meshUuid,
    mass: Number(opts?.mass) || 1,
    radius: r * Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z),
    restitution: opts?.restitution ?? 0.5,
    vel: [0, 0, 0],
    kinematic: !!opts?.kinematic,
  });
  return { ok: true, uuid };
}

export function addForce(kind, params) {
  const uuid = _uuid();
  _state.forces.push({
    uuid,
    kind,
    strength: Number(params?.strength) || 1,
    direction: params?.direction || [0, -9.81, 0],
    center: params?.center || [0, 0, 0],
    falloff: Number(params?.falloff) || 0,
  });
  return { ok: true, uuid };
}

export function addConstraint(kind, aUuid, bUuid, params) {
  const a = _state.objects.find((o) => o.uuid === aUuid);
  const b = _state.objects.find((o) => o.uuid === bUuid);
  if (!a || !b) return { ok: false };
  const uuid = _uuid();
  _state.constraints.push({
    uuid,
    kind,
    aUuid, bUuid,
    distance: params?.distance ?? null,
    stiffness: params?.stiffness ?? 0.8,
  });
  return { ok: true, uuid };
}

function _meshOf(obj) {
  const scene = window.__archdiscScene;
  return scene ? scene.getObjectByProperty('uuid', obj.meshUuid) : null;
}

function _applyForces(obj, mesh, dt) {
  for (const f of _state.forces) {
    if (f.kind === 'gravity') {
      obj.vel[0] += f.direction[0] * f.strength * dt;
      obj.vel[1] += f.direction[1] * f.strength * dt;
      obj.vel[2] += f.direction[2] * f.strength * dt;
    } else if (f.kind === 'wind') {
      obj.vel[0] += f.direction[0] * f.strength * dt;
      obj.vel[1] += f.direction[1] * f.strength * dt;
      obj.vel[2] += f.direction[2] * f.strength * dt;
    } else if (f.kind === 'attract') {
      const dx = f.center[0] - mesh.position.x;
      const dy = f.center[1] - mesh.position.y;
      const dz = f.center[2] - mesh.position.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const w = f.falloff > 0 ? Math.max(0, 1 - d / f.falloff) : 1;
      obj.vel[0] += dx / d * f.strength * w * dt;
      obj.vel[1] += dy / d * f.strength * w * dt;
      obj.vel[2] += dz / d * f.strength * w * dt;
    } else if (f.kind === 'repel') {
      const dx = mesh.position.x - f.center[0];
      const dy = mesh.position.y - f.center[1];
      const dz = mesh.position.z - f.center[2];
      const d = Math.hypot(dx, dy, dz) || 1;
      const w = f.falloff > 0 ? Math.max(0, 1 - d / f.falloff) : 1;
      obj.vel[0] += dx / d * f.strength * w * dt;
      obj.vel[1] += dy / d * f.strength * w * dt;
      obj.vel[2] += dz / d * f.strength * w * dt;
    } else if (f.kind === 'drag') {
      obj.vel[0] *= 1 - Math.min(1, f.strength * dt);
      obj.vel[1] *= 1 - Math.min(1, f.strength * dt);
      obj.vel[2] *= 1 - Math.min(1, f.strength * dt);
    }
  }
}

function _applyConstraints() {
  for (const c of _state.constraints) {
    const a = _state.objects.find((o) => o.uuid === c.aUuid);
    const b = _state.objects.find((o) => o.uuid === c.bUuid);
    if (!a || !b) continue;
    const ma = _meshOf(a), mb = _meshOf(b);
    if (!ma || !mb) continue;
    if (c.kind === 'distance') {
      const dx = mb.position.x - ma.position.x;
      const dy = mb.position.y - ma.position.y;
      const dz = mb.position.z - ma.position.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const target = c.distance != null ? c.distance : d;
      const diff = (d - target) / d * c.stiffness * 0.5;
      const nx = dx * diff, ny = dy * diff, nz = dz * diff;
      if (!a.kinematic) { ma.position.x += nx; ma.position.y += ny; ma.position.z += nz; }
      if (!b.kinematic) { mb.position.x -= nx; mb.position.y -= ny; mb.position.z -= nz; }
    }
  }
}

function _stepObjects(dt) {
  for (const obj of _state.objects) {
    if (obj.kinematic) continue;
    const mesh = _meshOf(obj);
    if (!mesh) continue;
    _applyForces(obj, mesh, dt);
    mesh.position.x += obj.vel[0] * dt;
    mesh.position.y += obj.vel[1] * dt;
    mesh.position.z += obj.vel[2] * dt;
    // Ground collision.
    if (_state.ground.enabled) {
      const minY = _state.ground.y + obj.radius;
      if (mesh.position.y < minY) {
        mesh.position.y = minY;
        if (obj.vel[1] < 0) obj.vel[1] = -obj.vel[1] * obj.restitution;
        obj.vel[0] *= _state.ground.friction;
        obj.vel[2] *= _state.ground.friction;
      }
    }
  }
  _applyConstraints();
}

function _tick(now) {
  if (!_state.running) return;
  if (!_state.lastTickMs) _state.lastTickMs = now;
  const dt = Math.min(0.05, (now - _state.lastTickMs) / 1000);
  _state.lastTickMs = now;
  _stepObjects(dt);
}

export function start() {
  if (_state.running) return { ok: true };
  _state.running = true;
  _state.lastTickMs = 0;
  chainIntoAnimTick('dops', _tick);
  return { ok: true };
}

export function stop() {
  _state.running = false;
  unchainFromAnimTick('dops');
  return { ok: true };
}

export function reset() {
  for (const obj of _state.objects) {
    obj.vel[0] = obj.vel[1] = obj.vel[2] = 0;
  }
  return { ok: true };
}

export function setGround(y, enabled, friction) {
  if (y != null) _state.ground.y = Number(y);
  if (enabled != null) _state.ground.enabled = !!enabled;
  if (friction != null) _state.ground.friction = Math.max(0, Math.min(1, Number(friction)));
  return { ok: true };
}

export function removeObject(uuid) {
  _state.objects = _state.objects.filter((o) => o.uuid !== uuid);
  _state.constraints = _state.constraints.filter((c) => c.aUuid !== uuid && c.bUuid !== uuid);
  return { ok: true };
}

export function removeForce(uuid) {
  _state.forces = _state.forces.filter((f) => f.uuid !== uuid);
  return { ok: true };
}

export function removeConstraint(uuid) {
  _state.constraints = _state.constraints.filter((c) => c.uuid !== uuid);
  return { ok: true };
}

export function getStats() {
  return {
    ok: true,
    objects: _state.objects.length,
    forces: _state.forces.length,
    constraints: _state.constraints.length,
    running: _state.running,
  };
}
