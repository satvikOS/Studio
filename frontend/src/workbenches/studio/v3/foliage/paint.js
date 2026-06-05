// ArchDisc Studio V3 — foliage paint mode.
//
// Enter / exit paint mode on a given scatter. While active, a pointer
// drag on the viewport canvas:
//
//   • shift NOT held: raycasts against the foliage's target surface,
//     and on hit ADDS a small cluster of instances at the hit point
//     (random rotation + scale within the foliage's existing variance).
//   • shift HELD: removes the nearest N instances within a brush
//     radius of the hit point (closest first).
//
// Cluster-add walks the InstancedMesh's existing slot count and bumps
// it by `addRate` per pointermove (capped at maxInstances). When
// `inst.count + addRate > inst.maxCount`, we recreate the InstancedMesh
// with a larger backing buffer; existing matrices are copied across
// 1:1, so wind / LOD references stay correct.
//
// All matrices + cached state on userData.archdiscStudioFoliage are
// kept in sync so subsequent wind / LOD ticks pick up the new
// instances seamlessly.
//
// While paint mode is active, OrbitControls is disabled on
// pointerdown + re-enabled on pointerup, so brush strokes don't
// orbit the camera. Cursor on the canvas becomes "crosshair".
//
// Idempotent install() / uninstall(); reuses one pointer listener trio
// regardless of how many enter/exit cycles happen.

import * as THREE from 'three';
import { findFoliageByUuid, __internal as scatterInt } from './scatter.js';
import { rebindLowInst, rebindHighInst } from './lod.js';
import { rebindWindInst } from './wind.js';

const TAG = scatterInt.FOLIAGE_TAG;

const _paintState = {
  active: false,
  scatterUuid: null,
  dom: null,
  prevCursor: '',
  prevOrbitEnabled: null,
  pointerDown: false,
  shiftDown: false,
  pointerId: null,
  onDown: null,
  onMove: null,
  onUp: null,
  onKeyDown: null,
  onKeyUp: null,
  raycaster: new THREE.Raycaster(),
  ndc: new THREE.Vector2(),
  rng: null,
  // brush params
  brushRadius: 0.5,
  addRate: 4,           // instances added per move while painting
  removeCount: 4,       // instances removed per move while shift-painting
  cooldownMs: 30,       // throttle paint events
  lastEvtMs: 0,
};

function viewport() {
  return (typeof window !== 'undefined') ? (window.__archdiscViewport || null) : null;
}

function camera() {
  const vp = viewport();
  return (vp && vp.camera) || null;
}

function orbit() {
  const vp = viewport();
  return (vp && vp.orbitControls) || null;
}

function dom() {
  const vp = viewport();
  return (vp && vp.renderer && vp.renderer.domElement) || null;
}

function scene() {
  return scatterInt.scene();
}

// Deterministic local RNG so undo / redo of a paint stroke reproduces.
function mulberry32(a) {
  let s = a >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setNdcFromEvent(ev, d) {
  const r = d.getBoundingClientRect();
  const w = r.width > 0 ? r.width : 1;
  const h = r.height > 0 ? r.height : 1;
  _paintState.ndc.x = ((ev.clientX - r.left) / w) * 2 - 1;
  _paintState.ndc.y = -((ev.clientY - r.top) / h) * 2 + 1;
}

// Raycast against the target surface of the active foliage scatter.
// Returns { point, normal } in world space, or null on miss.
function raycastTarget(ev) {
  const d = dom(); const cam = camera();
  if (!d || !cam || !_paintState.scatterUuid) return null;
  const inst = findFoliageByUuid(_paintState.scatterUuid);
  if (!inst || !inst.userData || !inst.userData[TAG]) return null;
  const tgt = scatterInt.findMeshByUuid(inst.userData[TAG].targetUuid);
  if (!tgt) return null;
  setNdcFromEvent(ev, d);
  _paintState.raycaster.setFromCamera(_paintState.ndc, cam);
  // Ensure target world matrix is current before the intersect test.
  tgt.updateMatrixWorld(true);
  const hits = _paintState.raycaster.intersectObject(tgt, true);
  if (!hits.length) return null;
  const h = hits[0];
  return {
    point: h.point.clone(),
    normal: h.face ? h.face.normal.clone() : null,
    target: tgt,
  };
}

// Grow the InstancedMesh's underlying buffer if necessary. Returns the
// (possibly new) InstancedMesh; callers must re-resolve their reference.
function ensureCapacity(inst, neededCount) {
  if (neededCount <= inst.instanceMatrix.array.length / 16) return inst;
  const newCap = Math.max(neededCount, Math.ceil(inst.count * 1.5) + 16);
  // Build a NEW InstancedMesh with the same geometry+material+userData
  // and copy every matrix across. Then swap it for the old one in the
  // scene; userData[TAG].baseMatrices/positions/baseRot/baseScale grow
  // in step. Important: the `lod` low-inst partner ALSO needs resizing
  // — we recreate it in setupLOD form.
  const meta = inst.userData[TAG];
  const oldCount = inst.count;
  const next = new THREE.InstancedMesh(inst.geometry, inst.material, newCap);
  next.castShadow = inst.castShadow;
  next.receiveShadow = inst.receiveShadow;
  next.name = inst.name;
  const m = new THREE.Matrix4();
  for (let i = 0; i < oldCount; i++) {
    inst.getMatrixAt(i, m);
    next.setMatrixAt(i, m);
  }
  next.count = oldCount;
  next.instanceMatrix.needsUpdate = true;
  // Migrate userData (deep ref preserved — every meta field is rewritten below).
  next.userData = inst.userData;
  next.uuid = inst.uuid; // keep uuid stable so all external refs survive
  // Grow Float32 caches to newCap.
  const grow = (src, perItem) => {
    const out = new Float32Array(newCap * perItem);
    out.set(src.subarray(0, oldCount * perItem));
    return out;
  };
  meta.positions = grow(meta.positions, 3);
  meta.baseRot = grow(meta.baseRot, 1);
  meta.baseScale = grow(meta.baseScale, 1);
  // baseMatrices is an Array of Matrix4 — extend it directly.
  while (meta.baseMatrices.length < newCap) meta.baseMatrices.push(new THREE.Matrix4());
  // Swap into scene.
  const parent = inst.parent;
  if (parent) {
    parent.remove(inst);
    parent.add(next);
  }
  // Rebind LOD/wind registries so their per-frame ticks write into the new buffer.
  try { rebindHighInst(inst.uuid, next); } catch (_) {}
  try { rebindWindInst(inst.uuid, next); } catch (_) {}
  // If LOD pair exists, also grow it.
  if (meta.lod && meta.lod.lowInst) {
    const oldLow = meta.lod.lowInst;
    const nextLow = new THREE.InstancedMesh(oldLow.geometry, oldLow.material, newCap);
    nextLow.castShadow = oldLow.castShadow;
    nextLow.receiveShadow = oldLow.receiveShadow;
    nextLow.name = oldLow.name;
    nextLow.userData = oldLow.userData;
    nextLow.uuid = oldLow.uuid;
    const mm = new THREE.Matrix4();
    for (let i = 0; i < oldCount; i++) {
      oldLow.getMatrixAt(i, mm);
      nextLow.setMatrixAt(i, mm);
    }
    nextLow.count = oldCount;
    nextLow.instanceMatrix.needsUpdate = true;
    const lowParent = oldLow.parent;
    if (lowParent) {
      lowParent.remove(oldLow);
      lowParent.add(nextLow);
    }
    meta.lod.lowInst = nextLow;
    // The LOD registry holds its own ref to the low inst too — rebind
    // it so the next LOD tick writes into the new backing buffer.
    try { rebindLowInst(inst.uuid, nextLow); } catch (_) {}
  }
  return next;
}

// Add a cluster of N instances around world-space `point` within radius.
function addCluster(scatterUuid, point, normalIsh, radius, n) {
  let inst = findFoliageByUuid(scatterUuid);
  if (!inst) return { ok: false, error: 'no foliage' };
  const meta = inst.userData[TAG];
  const variance = meta.variance != null ? meta.variance : 0.25;
  const minS = Math.max(0.01, 1 - variance);
  const maxS = 1 + variance;
  const newCount = inst.count + n;
  inst = ensureCapacity(inst, newCount);
  const dummy = new THREE.Object3D();
  const rng = _paintState.rng;
  for (let k = 0; k < n; k++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * radius;
    const px = point.x + Math.cos(a) * r;
    const pz = point.z + Math.sin(a) * r;
    const py = point.y;
    const idx = inst.count;
    const yRot = rng() * Math.PI * 2;
    const s = minS + (maxS - minS) * rng();
    meta.positions[idx * 3]     = px;
    meta.positions[idx * 3 + 1] = py;
    meta.positions[idx * 3 + 2] = pz;
    meta.baseRot[idx] = yRot;
    meta.baseScale[idx] = s;
    dummy.position.set(px, py, pz);
    dummy.rotation.set(0, yRot, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    inst.setMatrixAt(idx, dummy.matrix);
    if (!meta.baseMatrices[idx]) meta.baseMatrices[idx] = new THREE.Matrix4();
    meta.baseMatrices[idx].copy(dummy.matrix);
    inst.count = idx + 1;
    // Mirror into LOD low partner so its slot grows in step.
    if (meta.lod && meta.lod.lowInst) {
      meta.lod.lowInst.setMatrixAt(idx, dummy.matrix);
      meta.lod.lowInst.count = idx + 1;
    }
  }
  inst.instanceMatrix.needsUpdate = true;
  if (meta.lod && meta.lod.lowInst) meta.lod.lowInst.instanceMatrix.needsUpdate = true;
  meta.count = inst.count;
  return { ok: true, added: n, count: inst.count };
}

// Remove the up-to-N closest instances within radius of `point`.
// We compact the matrix buffer in place: swap-with-last-and-shrink so
// no holes are left.
function removeCluster(scatterUuid, point, radius, n) {
  const inst = findFoliageByUuid(scatterUuid);
  if (!inst) return { ok: false, error: 'no foliage' };
  const meta = inst.userData[TAG];
  const N = inst.count;
  if (N === 0) return { ok: true, removed: 0, count: 0 };
  // Collect indices within radius, sorted by distance.
  const positions = meta.positions;
  const within = [];
  const r2 = radius * radius;
  for (let i = 0; i < N; i++) {
    const dx = positions[i * 3]     - point.x;
    const dy = positions[i * 3 + 1] - point.y;
    const dz = positions[i * 3 + 2] - point.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= r2) within.push([d2, i]);
  }
  if (!within.length) return { ok: true, removed: 0, count: N };
  within.sort((a, b) => a[0] - b[0]);
  const toRemove = within.slice(0, n).map((p) => p[1]).sort((a, b) => b - a); // descending so swaps don't invalidate
  const tmp = new THREE.Matrix4();
  const low = meta.lod && meta.lod.lowInst;
  for (const idx of toRemove) {
    const last = inst.count - 1;
    if (idx !== last) {
      // Move last → idx for matrix + caches.
      inst.getMatrixAt(last, tmp);
      inst.setMatrixAt(idx, tmp);
      meta.baseMatrices[idx].copy(meta.baseMatrices[last]);
      meta.positions[idx * 3]     = meta.positions[last * 3];
      meta.positions[idx * 3 + 1] = meta.positions[last * 3 + 1];
      meta.positions[idx * 3 + 2] = meta.positions[last * 3 + 2];
      meta.baseRot[idx] = meta.baseRot[last];
      meta.baseScale[idx] = meta.baseScale[last];
      if (low) {
        low.getMatrixAt(last, tmp);
        low.setMatrixAt(idx, tmp);
      }
    }
    inst.count -= 1;
    if (low) low.count -= 1;
  }
  inst.instanceMatrix.needsUpdate = true;
  if (low) low.instanceMatrix.needsUpdate = true;
  meta.count = inst.count;
  return { ok: true, removed: toRemove.length, count: inst.count };
}

// ─── Pointer handlers ───────────────────────────────────────────────────
function _onDown(ev) {
  if (!_paintState.active) return;
  if (ev.button != null && ev.button !== 0) return;
  const d = dom();
  if (!d) return;
  const ob = orbit();
  if (ob) {
    _paintState.prevOrbitEnabled = !!ob.enabled;
    ob.enabled = false;
  }
  _paintState.pointerDown = true;
  _paintState.pointerId = ev.pointerId != null ? ev.pointerId : null;
  _paintState.lastEvtMs = 0;
  try {
    if (_paintState.pointerId != null && typeof ev.target.setPointerCapture === 'function') {
      ev.target.setPointerCapture(_paintState.pointerId);
    }
  } catch (_) {}
  // First stroke point — paint immediately.
  _paintStroke(ev);
  ev.preventDefault();
  ev.stopPropagation();
}

function _onMove(ev) {
  if (!_paintState.active || !_paintState.pointerDown) return;
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  if (now - _paintState.lastEvtMs < _paintState.cooldownMs) return;
  _paintState.lastEvtMs = now;
  _paintStroke(ev);
  ev.preventDefault();
}

function _onUp(ev) {
  if (!_paintState.active) return;
  _paintState.pointerDown = false;
  const ob = orbit();
  if (ob) ob.enabled = _paintState.prevOrbitEnabled == null ? true : _paintState.prevOrbitEnabled;
  try {
    if (_paintState.pointerId != null && ev && ev.target && typeof ev.target.releasePointerCapture === 'function') {
      ev.target.releasePointerCapture(_paintState.pointerId);
    }
  } catch (_) {}
  _paintState.pointerId = null;
}

function _onKeyDown(ev) {
  if (ev.key === 'Shift') _paintState.shiftDown = true;
}
function _onKeyUp(ev) {
  if (ev.key === 'Shift') _paintState.shiftDown = false;
}

function _paintStroke(ev) {
  if (!_paintState.scatterUuid) return;
  const hit = raycastTarget(ev);
  if (!hit) return;
  const shift = !!(ev.shiftKey || _paintState.shiftDown);
  if (shift) {
    removeCluster(_paintState.scatterUuid, hit.point, _paintState.brushRadius, _paintState.removeCount);
  } else {
    addCluster(_paintState.scatterUuid, hit.point, hit.normal, _paintState.brushRadius, _paintState.addRate);
  }
}

// ─── Public ─────────────────────────────────────────────────────────────
export function enterPaintMode(scatterUuid, opts) {
  const inst = findFoliageByUuid(scatterUuid);
  if (!inst) return { ok: false, error: 'no foliage scatter by uuid' };
  const o = opts || {};
  _paintState.brushRadius = Number.isFinite(+o.brushRadius) ? +o.brushRadius : 0.5;
  _paintState.addRate = Math.max(1, Math.floor(+o.addRate || 4));
  _paintState.removeCount = Math.max(1, Math.floor(+o.removeCount || 4));
  _paintState.rng = mulberry32((inst.userData[TAG].seed | 0) ^ 0xBEEFCAFE);
  _paintState.scatterUuid = scatterUuid;
  if (_paintState.active) return { ok: true, alreadyActive: true, scatterUuid };
  _paintState.active = true;
  const d = dom();
  if (d) {
    _paintState.dom = d;
    _paintState.prevCursor = d.style.cursor || '';
    d.style.cursor = 'crosshair';
    _paintState.onDown = _onDown;
    _paintState.onMove = _onMove;
    _paintState.onUp = _onUp;
    d.addEventListener('pointerdown', _paintState.onDown, true);
    window.addEventListener('pointermove', _paintState.onMove, true);
    window.addEventListener('pointerup', _paintState.onUp, true);
    window.addEventListener('pointercancel', _paintState.onUp, true);
  }
  _paintState.onKeyDown = _onKeyDown;
  _paintState.onKeyUp = _onKeyUp;
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', _paintState.onKeyDown, true);
    window.addEventListener('keyup', _paintState.onKeyUp, true);
  }
  return { ok: true, scatterUuid, brushRadius: _paintState.brushRadius };
}

export function exitPaintMode() {
  if (!_paintState.active) return { ok: true, alreadyExited: true };
  _paintState.active = false;
  if (_paintState.dom) {
    _paintState.dom.style.cursor = _paintState.prevCursor || '';
    try { _paintState.dom.removeEventListener('pointerdown', _paintState.onDown, true); } catch (_) {}
  }
  try { window.removeEventListener('pointermove', _paintState.onMove, true); } catch (_) {}
  try { window.removeEventListener('pointerup', _paintState.onUp, true); } catch (_) {}
  try { window.removeEventListener('pointercancel', _paintState.onUp, true); } catch (_) {}
  try { window.removeEventListener('keydown', _paintState.onKeyDown, true); } catch (_) {}
  try { window.removeEventListener('keyup', _paintState.onKeyUp, true); } catch (_) {}
  const ob = orbit();
  if (ob && _paintState.prevOrbitEnabled != null) ob.enabled = _paintState.prevOrbitEnabled;
  const last = { scatterUuid: _paintState.scatterUuid };
  _paintState.dom = null;
  _paintState.scatterUuid = null;
  _paintState.prevOrbitEnabled = null;
  _paintState.pointerDown = false;
  _paintState.pointerId = null;
  return { ok: true, ...last };
}

export function paintModeStatus() {
  return {
    ok: true,
    active: _paintState.active,
    scatterUuid: _paintState.scatterUuid,
    brushRadius: _paintState.brushRadius,
    addRate: _paintState.addRate,
    removeCount: _paintState.removeCount,
  };
}

// Programmatic helpers (used by tests + the panel "click to paint" mode).
export function addAt(scatterUuid, worldPoint, opts) {
  const o = opts || {};
  const radius = Number.isFinite(+o.brushRadius) ? +o.brushRadius : 0.5;
  const n = Math.max(1, Math.floor(+o.addRate || 4));
  if (!_paintState.rng) {
    const inst = findFoliageByUuid(scatterUuid);
    if (!inst) return { ok: false, error: 'no foliage' };
    _paintState.rng = mulberry32((inst.userData[TAG].seed | 0) ^ 0xBEEFCAFE);
  }
  const p = new THREE.Vector3(worldPoint[0], worldPoint[1], worldPoint[2]);
  return addCluster(scatterUuid, p, null, radius, n);
}

export function removeAt(scatterUuid, worldPoint, opts) {
  const o = opts || {};
  const radius = Number.isFinite(+o.brushRadius) ? +o.brushRadius : 0.5;
  const n = Math.max(1, Math.floor(+o.removeCount || 4));
  const p = new THREE.Vector3(worldPoint[0], worldPoint[1], worldPoint[2]);
  return removeCluster(scatterUuid, p, radius, n);
}

export const __internal = { _paintState, addCluster, removeCluster, ensureCapacity, raycastTarget };
