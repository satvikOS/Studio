// Slice 724 — C4D MoGraph Tracer. Attach to a slice-703 niagara
// particle system or to any moving objects in the scene; record
// per-frame positions into per-object history; render the history
// as a THREE.Line. Mirrors C4D's Tracer Object — used to draw
// motion trails behind particles or animated objects.

import * as THREE from 'three';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';

const _tracers = new Map();
let _seq = 1;
function _uid() { return `tr-${_seq++}-${Date.now().toString(36)}`; }

function _makeLine(color, maxPoints) {
  const positions = new Float32Array(maxPoints * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
  return { line: new THREE.Line(geo, mat), positions };
}

export function trackObjects(uuids, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const maxPoints = Math.max(8, Math.min(2000, Number(opts?.length) || 200));
  const color = opts?.color || 0xff8030;
  const lineColor = new THREE.Color(typeof color === 'number' ? color : 0xff8030);
  const id = _uid();
  const tracker = {
    id,
    targets: uuids.slice(),
    perObject: new Map(),
    maxPoints,
    color: lineColor,
    enabled: true,
  };
  for (const uuid of uuids) {
    const { line, positions } = _makeLine(lineColor, maxPoints);
    scene.add(line);
    tracker.perObject.set(uuid, { line, positions, head: 0, count: 0 });
  }
  _tracers.set(id, tracker);
  chainIntoAnimTick(`tracer_${id}`, () => _tick(tracker));
  return { ok: true, id };
}

function _tick(tracker) {
  if (!tracker.enabled) return;
  const scene = window.__archdiscScene;
  if (!scene) return;
  for (const uuid of tracker.targets) {
    const o = scene.getObjectByProperty('uuid', uuid);
    if (!o) continue;
    const entry = tracker.perObject.get(uuid);
    if (!entry) continue;
    const wp = o.getWorldPosition(new THREE.Vector3());
    entry.positions[entry.head * 3]     = wp.x;
    entry.positions[entry.head * 3 + 1] = wp.y;
    entry.positions[entry.head * 3 + 2] = wp.z;
    entry.head = (entry.head + 1) % tracker.maxPoints;
    entry.count = Math.min(tracker.maxPoints, entry.count + 1);
    entry.line.geometry.attributes.position.needsUpdate = true;
    entry.line.geometry.setDrawRange(0, entry.count);
  }
}

export function setEnabled(id, enabled) {
  const t = _tracers.get(id);
  if (!t) return { ok: false };
  t.enabled = !!enabled;
  return { ok: true };
}

export function clearTrail(id) {
  const t = _tracers.get(id);
  if (!t) return { ok: false };
  for (const entry of t.perObject.values()) {
    entry.head = 0; entry.count = 0;
    entry.line.geometry.setDrawRange(0, 0);
  }
  return { ok: true };
}

export function removeTracker(id) {
  const t = _tracers.get(id);
  if (!t) return { ok: false };
  unchainFromAnimTick(`tracer_${id}`);
  for (const entry of t.perObject.values()) {
    if (entry.line.parent) entry.line.parent.remove(entry.line);
    entry.line.geometry.dispose();
    entry.line.material.dispose();
  }
  _tracers.delete(id);
  return { ok: true };
}

export function listTrackers() {
  return {
    ok: true,
    trackers: Array.from(_tracers.values()).map((t) => ({
      id: t.id, targets: t.targets.length, enabled: t.enabled, maxPoints: t.maxPoints,
    })),
  };
}
