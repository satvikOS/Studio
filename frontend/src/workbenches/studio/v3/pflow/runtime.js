// Slice 698 — Particle Flow runtime: per-frame walk of every active
// particle through its current event's operators + tests.

import * as THREE from 'three';
import { mulberry32 } from '../common/random.js';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';
import { getEvent, listEvents, applyOperators, evaluateTests } from './events.js';

let _running = false;
let _particles = [];
let _renderPoints = null;
let _rng = mulberry32(42);
let _spawnAccum = 0;
let _lastTickMs = 0;
let _stats = { transitions: 0 };

function _ensureRenderTarget(capacity) {
  if (_renderPoints && _renderPoints.geometry.attributes.position.count >= capacity) return;
  if (_renderPoints && _renderPoints.parent) _renderPoints.parent.remove(_renderPoints);
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ size: 0.05, vertexColors: true, transparent: true, depthWrite: false });
  _renderPoints = new THREE.Points(geo, mat);
  _renderPoints.userData.archdiscStudioGizmo = true;
  if (window.__archdiscScene) window.__archdiscScene.add(_renderPoints);
}

function _writeBuffers() {
  if (!_renderPoints) return;
  const pos = _renderPoints.geometry.attributes.position.array;
  const col = _renderPoints.geometry.attributes.color.array;
  for (let i = 0; i < _particles.length; i++) {
    const p = _particles[i];
    pos[i * 3]     = p.x;
    pos[i * 3 + 1] = p.y;
    pos[i * 3 + 2] = p.z;
    const alive = p.dead ? 0 : 1;
    col[i * 3]     = 1 * alive;
    col[i * 3 + 1] = 0.6 * alive;
    col[i * 3 + 2] = 0.2 * alive;
  }
  // hide any leftover slots
  for (let i = _particles.length; i < pos.length / 3; i++) {
    pos[i * 3] = pos[i * 3 + 1] = pos[i * 3 + 2] = 0;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
  }
  _renderPoints.geometry.attributes.position.needsUpdate = true;
  _renderPoints.geometry.attributes.color.needsUpdate = true;
}

function _findBirthEvent() {
  return listEvents().find((e) => e.enabled && e.operators.some((o) => o.name === 'birth'));
}

function _tick(now) {
  if (!_running) return;
  if (!_lastTickMs) _lastTickMs = now;
  const dt = Math.min(0.05, (now - _lastTickMs) / 1000);
  _lastTickMs = now;

  // Spawn new particles from birth events.
  const birthEv = _findBirthEvent();
  if (birthEv) {
    const birthOp = birthEv.operators.find((o) => o.name === 'birth');
    const rate = birthOp.params.rate ?? 50;
    _spawnAccum += rate * dt;
    while (_spawnAccum > 1 && _particles.length < 4000) {
      _spawnAccum -= 1;
      _particles.push({
        x: 0, y: 0, z: 0,
        vx: 0, vy: 0, vz: 0,
        age: 0, dead: false,
        eventUuid: birthEv.uuid,
      });
    }
  }

  // Process particles.
  for (let i = 0; i < _particles.length; i++) {
    const p = _particles[i];
    if (p.dead) continue;
    const ev = getEvent(p.eventUuid);
    if (!ev || !ev.enabled) continue;
    applyOperators(p, ev, dt, _rng);
    const next = evaluateTests(p, ev, _rng);
    if (next) {
      p.eventUuid = next;
      p._velSet = false;
      _stats.transitions++;
    }
  }
  _particles = _particles.filter((p) => !p.dead);
  _ensureRenderTarget(Math.max(256, _particles.length));
  _writeBuffers();
}

export function start() {
  if (_running) return { ok: true, on: true };
  _running = true;
  _lastTickMs = 0;
  _spawnAccum = 0;
  _stats.transitions = 0;
  chainIntoAnimTick('pflow', _tick);
  return { ok: true, on: true };
}

export function stop() {
  if (!_running) return { ok: true, on: false };
  _running = false;
  unchainFromAnimTick('pflow');
  return { ok: true, on: false };
}

export function reset() {
  _particles = [];
  _stats.transitions = 0;
  if (_renderPoints) _writeBuffers();
  return { ok: true };
}

export function getStats() {
  return {
    ok: true,
    activeParticles: _particles.length,
    events: listEvents().length,
    transitions: _stats.transitions,
    running: _running,
  };
}
