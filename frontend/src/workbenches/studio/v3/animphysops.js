// ArchDisc Studio V3 — animation + physics ops.
//
// Animation: V2 slices 213/214 (frame state + keyframes), plus the slim
// blueprint + behaviour-tree tick stubs that V2 exposes.
// Physics: V2 slice 224 (step + state), plus the constraint API (V2 308).
//
// V3 keeps the same return-shapes V2 uses so cmdbar + Archie tool-call
// schemas stay portable.

import * as THREE from 'three';

function vp() { return window.__archdiscViewport || null; }
function scene() { return window.__archdiscScene || (vp() && vp().scene) || null; }
function activeMesh() {
  const v = vp();
  return (v && v.getSelected && v.getSelected()) || null;
}
function eachPrim() {
  const s = scene(); if (!s) return [];
  const out = [];
  s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) out.push(o); });
  return out;
}

// ─── Animation state ─────────────────────────────────────────────────────
let _frame = 0;
let _animating = false;
const FPS = 24;
function getFrame() { return _frame; }
function setFrame(frame) {
  if (typeof frame !== 'number' || !Number.isFinite(frame) || frame < 0) return { ok: false, error: 'bad frame' };
  _frame = Math.floor(frame);
  // Evaluate keyframes against the new frame.
  evaluateKeyframes();
  window.dispatchEvent(new CustomEvent('studio-frame-changed', { detail: { frame: _frame } }));
  return { ok: true, frame: _frame };
}
function toggleAnimating() {
  _animating = !_animating;
  window.dispatchEvent(new CustomEvent('studio-animating-changed', { detail: { animating: _animating } }));
  return { ok: true, animating: _animating };
}
function getAnimating() { return _animating; }

// Per-mesh keyframe map: uuid -> [{frame, position, rotation, scale}, …]
function _kfMap(mesh) {
  if (!mesh.userData) mesh.userData = {};
  if (!Array.isArray(mesh.userData.archdiscStudioKeyframes)) mesh.userData.archdiscStudioKeyframes = [];
  return mesh.userData.archdiscStudioKeyframes;
}
function insertKeyframeAt(frame) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  if (typeof frame !== 'number') frame = _frame;
  const kfs = _kfMap(m);
  // Replace any existing key at this frame.
  const filtered = kfs.filter((k) => k.frame !== frame);
  filtered.push({
    frame,
    position: [m.position.x, m.position.y, m.position.z],
    rotation: [m.rotation.x, m.rotation.y, m.rotation.z],
    scale:    [m.scale.x, m.scale.y, m.scale.z],
  });
  filtered.sort((a, b) => a.frame - b.frame);
  m.userData.archdiscStudioKeyframes = filtered;
  return { ok: true, frame, count: filtered.length };
}
function getKeyframes(uuid) {
  let target = null;
  if (uuid) { const s = scene(); s && s.traverse((o) => { if (o.uuid === uuid) target = o; }); }
  else target = activeMesh();
  if (!target) return { ok: false, error: 'no mesh' };
  return { ok: true, keyframes: _kfMap(target).slice() };
}
// Interpolate every keyframed mesh to _frame.
function evaluateKeyframes() {
  for (const m of eachPrim()) {
    const kfs = _kfMap(m);
    if (kfs.length === 0) continue;
    // Find the two surrounding frames.
    let prev = null, next = null;
    for (const k of kfs) {
      if (k.frame <= _frame) prev = k;
      if (k.frame >= _frame && !next) next = k;
    }
    if (!prev && !next) continue;
    if (!prev) prev = next;
    if (!next) next = prev;
    const span = next.frame - prev.frame;
    const t = span > 0 ? (_frame - prev.frame) / span : 0;
    const lerp = (a, b) => a + (b - a) * t;
    m.position.set(lerp(prev.position[0], next.position[0]), lerp(prev.position[1], next.position[1]), lerp(prev.position[2], next.position[2]));
    m.rotation.set(lerp(prev.rotation[0], next.rotation[0]), lerp(prev.rotation[1], next.rotation[1]), lerp(prev.rotation[2], next.rotation[2]));
    m.scale.set(lerp(prev.scale[0], next.scale[0]), lerp(prev.scale[1], next.scale[1]), lerp(prev.scale[2], next.scale[2]));
    m.updateMatrixWorld(true);
  }
}

// ─── Slim BP / BT / Niagara stubs (V2 had the same shape — Studio uses
//     these as Archie-tool surfaces, not full runtimes) ───────────────────
const _animBP = { state: 'idle', tick: 0 };
function animBPSet(state) { _animBP.state = String(state); return { ok: true, state: _animBP.state }; }
function animBPStep() { _animBP.tick++; return { ok: true, tick: _animBP.tick, state: _animBP.state }; }
const _bt = { last: null, ticks: 0 };
function btTick(payload = {}) { _bt.ticks++; _bt.last = payload; return { ok: true, ticks: _bt.ticks }; }
const _niagara = { particles: 0, age: 0 };
function niagaraStep(dt = 0.016) { _niagara.age += dt; _niagara.particles = Math.max(0, _niagara.particles - dt * 50); return { ok: true, ..._niagara }; }
function evalNiagara() { return { ok: true, ..._niagara }; }
function runBlueprint(name, params = {}) {
  if (typeof name !== 'string') return { ok: false, error: 'bad name' };
  return { ok: true, blueprint: name, params, ran: true };
}

// ─── Physics ─────────────────────────────────────────────────────────────
// Simple kinematic point-mass on each tagged primitive. Velocity stored in
// userData.physVel; gravity + damping baked into step(). State is mesh
// position/velocity tuples. Not a real solver — but it round-trips and
// honours add-constraint API so the Archie tool surface works.
function _physBodies() {
  return eachPrim().filter((o) => o.userData && o.userData.archdiscStudioPhysics);
}
let _constraints = [];

function physicsStep(dt = 0.016) {
  const bodies = _physBodies();
  for (const b of bodies) {
    if (!b.userData.physVel) b.userData.physVel = [0, 0, 0];
    const v = b.userData.physVel;
    // Gravity.
    v[1] += -9.81 * dt;
    // Apply velocity.
    b.position.x += v[0] * dt;
    b.position.y += v[1] * dt;
    b.position.z += v[2] * dt;
    // Floor at y=0 with bounce damping.
    if (b.position.y < 0) {
      b.position.y = 0;
      v[1] = -v[1] * 0.4;
      v[0] *= 0.8; v[2] *= 0.8;
    }
    b.updateMatrixWorld(true);
  }
  // Apply distance constraints.
  for (const c of _constraints) {
    const a = bodies.find((b) => b.uuid === c.a);
    const b2 = bodies.find((b) => b.uuid === c.b);
    if (!a || !b2) continue;
    const dx = b2.position.x - a.position.x;
    const dy = b2.position.y - a.position.y;
    const dz = b2.position.z - a.position.z;
    const d = Math.hypot(dx, dy, dz);
    if (d === 0) continue;
    const err = d - c.distance;
    const nx = dx / d, ny = dy / d, nz = dz / d;
    a.position.x += nx * err * 0.5;
    a.position.y += ny * err * 0.5;
    a.position.z += nz * err * 0.5;
    b2.position.x -= nx * err * 0.5;
    b2.position.y -= ny * err * 0.5;
    b2.position.z -= nz * err * 0.5;
  }
  return { ok: true, count: bodies.length, dt };
}
function physicsState() {
  return _physBodies().map((o) => ({
    uuid: o.uuid,
    pos: [o.position.x, o.position.y, o.position.z],
    vel: (o.userData.physVel || [0, 0, 0]).slice(),
  }));
}
function resetPhysics() {
  for (const b of _physBodies()) {
    b.userData.physVel = [0, 0, 0];
    if (b.userData.physResetPos) {
      b.position.set(...b.userData.physResetPos);
    }
  }
  _constraints = [];
  return { ok: true };
}
// Mark active mesh as a physics body (rest pos snapshot, vel zeroed).
function physicsEnable() {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  m.userData.archdiscStudioPhysics = true;
  m.userData.physVel = [0, 0, 0];
  m.userData.physResetPos = [m.position.x, m.position.y, m.position.z];
  return { ok: true, uuid: m.uuid };
}
function physicsAddConstraint(uuidA, uuidB, distance) {
  if (!uuidA || !uuidB) return { ok: false, error: 'need 2 uuids' };
  const id = `c-${_constraints.length}-${Date.now()}`;
  _constraints.push({ id, a: uuidA, b: uuidB, distance: distance != null ? distance : 0.1 });
  return { ok: true, id, count: _constraints.length };
}
function physicsListConstraints() {
  return _constraints.map((c) => ({ id: c.id, a: c.a, b: c.b, distance: c.distance }));
}
function physicsRemoveConstraint(id) {
  const before = _constraints.length;
  _constraints = _constraints.filter((c) => c.id !== id);
  return { ok: _constraints.length < before, removed: before - _constraints.length };
}
function physicsClearConstraints() {
  const n = _constraints.length;
  _constraints = [];
  return { ok: true, removed: n };
}

// ─── Registration ────────────────────────────────────────────────────────
export function registerAnimPhysOps() {
  // Override the toggle to use this module's state so getAnimating works.
  window.__studioToggleAnimating = toggleAnimating;
  window.__studioGetAnimating    = getAnimating;
  window.__studioGetFrame        = getFrame;
  window.__studioSetFrame        = setFrame;
  window.__studioInsertKeyframeAt = insertKeyframeAt;
  window.__studioGetKeyframes    = getKeyframes;
  window.__studioAnimBPSet       = animBPSet;
  window.__studioAnimBPStep      = animBPStep;
  window.__studioBTTick          = btTick;
  window.__studioNiagaraStep     = niagaraStep;
  window.__studioEvalNiagara     = evalNiagara;
  window.__studioRunBlueprint    = runBlueprint;
  window.__studioPhysicsStep              = physicsStep;
  window.__studioPhysicsState             = physicsState;
  window.__studioResetPhysics             = resetPhysics;
  window.__studioPhysicsEnable            = physicsEnable;
  window.__studioPhysicsAddConstraint     = physicsAddConstraint;
  window.__studioPhysicsListConstraints   = physicsListConstraints;
  window.__studioPhysicsRemoveConstraint  = physicsRemoveConstraint;
  window.__studioPhysicsClearConstraints  = physicsClearConstraints;
}
export function unregisterAnimPhysOps() {
  for (const k of [
    '__studioGetAnimating', '__studioGetFrame', '__studioSetFrame',
    '__studioInsertKeyframeAt', '__studioGetKeyframes',
    '__studioAnimBPSet', '__studioAnimBPStep', '__studioBTTick',
    '__studioNiagaraStep', '__studioEvalNiagara', '__studioRunBlueprint',
    '__studioPhysicsStep', '__studioPhysicsState', '__studioResetPhysics',
    '__studioPhysicsEnable', '__studioPhysicsAddConstraint',
    '__studioPhysicsListConstraints', '__studioPhysicsRemoveConstraint',
    '__studioPhysicsClearConstraints',
  ]) { try { delete window[k]; } catch (_) {} }
}
