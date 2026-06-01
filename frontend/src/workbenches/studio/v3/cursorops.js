// ArchDisc Studio V3 — Blender 3D Cursor family.
//
// V3-native ports of:
//   __studioSetCursor           — move the cursor to [x,y,z]
//   __studioGetCursor           — current cursor world position
//   __studioCursorWorld         — alias accessor
//   __studioSnapCursorOrigin    — snap cursor to world origin
//   __studioSnapCursorSelection — snap cursor to active selection

import * as THREE from 'three';

function scene() {
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}
function activeMesh() {
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}

const SIZE = 0.012;
let _cursor = null;

function ensureCursor() {
  const s = scene();
  if (!s) return null;
  if (_cursor && _cursor.parent === s) return _cursor;
  const group = new THREE.Group();
  group.userData.archdisc3DCursor = true;
  group.name = 'studio-3d-cursor';
  const make = (axis, color) => {
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(axis === 'x' ? -SIZE : 0, axis === 'y' ? -SIZE : 0, axis === 'z' ? -SIZE : 0),
      new THREE.Vector3(axis === 'x' ?  SIZE : 0, axis === 'y' ?  SIZE : 0, axis === 'z' ?  SIZE : 0),
    ]);
    const m = new THREE.LineBasicMaterial({ color });
    return new THREE.Line(g, m);
  };
  group.add(make('x', 0xff5555));
  group.add(make('y', 0x55ff55));
  group.add(make('z', 0x5555ff));
  s.add(group);
  _cursor = group;
  return group;
}

function setCursor(pos) {
  const c = ensureCursor();
  if (!c) return { ok: false, error: 'no scene' };
  const x = (Array.isArray(pos) ? pos[0] : (pos && pos.x)) || 0;
  const y = (Array.isArray(pos) ? pos[1] : (pos && pos.y)) || 0;
  const z = (Array.isArray(pos) ? pos[2] : (pos && pos.z)) || 0;
  c.position.set(x, y, z);
  return { ok: true, position: [x, y, z] };
}

function getCursor() {
  const c = ensureCursor();
  if (!c) return [0, 0, 0];
  return [c.position.x, c.position.y, c.position.z];
}

function snapCursorOrigin() {
  return setCursor([0, 0, 0]);
}

function snapCursorSelection() {
  const m = activeMesh();
  if (!m) return { ok: false, error: 'no selection' };
  return setCursor([m.position.x, m.position.y, m.position.z]);
}

export function registerCursorOps() {
  window.__studioSetCursor           = setCursor;
  window.__studioGetCursor           = getCursor;
  window.__studioCursorWorld         = getCursor;
  window.__studioSnapCursorOrigin    = snapCursorOrigin;
  window.__studioSnapCursorSelection = snapCursorSelection;
}

export function unregisterCursorOps() {
  for (const k of [
    '__studioSetCursor', '__studioGetCursor', '__studioCursorWorld',
    '__studioSnapCursorOrigin', '__studioSnapCursorSelection',
  ]) { try { delete window[k]; } catch (_) {} }
  if (_cursor && _cursor.parent) {
    _cursor.parent.remove(_cursor);
    _cursor.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
  _cursor = null;
}
