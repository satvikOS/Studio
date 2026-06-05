// ArchDisc Studio V3 — Live snap during drag.
//
// Slice 655 introduced a static snap state in api.js (mode + grid size
// + angleStep + lockedAxis + a `__studioSnapApply` pure-function helper).
// This module is the live half: while the TransformControls gizmo is
// being dragged, every pointermove computes a snap candidate from the
// scene geometry and writes it back onto the attached object so the
// mesh appears to "stick" to nearest vertex / edge midpoint / face
// center / grid line within `snapRadius`.
//
// Implementation notes
// --------------------
// • We listen at window-capture for `pointermove` so the gizmo's own
//   pointermove handler still runs first (its handler is attached on
//   the renderer dom element). After Three updates the object's
//   position from the raw cursor delta, our handler walks the scene
//   for snap candidates and overwrites the position with the snapped
//   value. TransformControls dispatches its own `change` event once
//   per frame so we don't have to.
// • We watch `dragging-changed` on the gizmo so we know when a drag is
//   in flight. While not dragging the listener short-circuits.
// • Candidate kinds: vertex / edge-midpoint / face-center / grid.
//   Each can be toggled independently in `kindMask`. The default mask
//   matches the snap state's `mode` slot from slice 655 (one of
//   'grid' | 'vertex' | 'edge' | 'face' | 'none') so toggling the
//   panel chip flips both surfaces in lockstep.
// • BVH path: if a mesh has a boundsTree we still walk its position
//   attribute for vertex snap (BVH is for raycast, not nearest-vertex).
//   For face-center snap we sample face centroids from the index
//   buffer — no raycast needed because we already know the candidate
//   "from" point is the dragged mesh's world centre.
// • We only consider primitive meshes (`userData.archdiscStudioPrimitive`
//   true) and *exclude* the attached gizmo target itself.

import * as THREE from 'three';

// Internal state -------------------------------------------------------
const _state = {
  installed: false,
  liveDragOn: false,
  snapRadius: 0.05,            // 5 cm default
  kindMask: {
    vertex: true,
    edge: true,
    face: false,
    grid: true,
  },
  gridSize: 0.1,               // mirrors __studioSnapState.gridSize default
  // Drag bookkeeping
  dragging: false,
  attachedMesh: null,
  // Cache of mesh → cached arrays (rebuilt when position.version bumps)
  _cache: new WeakMap(),
  // Last snap result (read by UI / tests)
  lastSnap: null,
  // Listener handles for clean tear-down
  _onPointer: null,
  _onDragging: null,
  _gizmoRef: null,
};

// Pull/push the snap state slot owned by slice 655 (in api.js).
function syncFromSliceState() {
  const s = (typeof window !== 'undefined') ? window.__studioSnapState : null;
  if (!s) return;
  if (typeof s.gridSize === 'number') _state.gridSize = s.gridSize;
  if (typeof s.mode === 'string') {
    // Slice 655 has a single-mode chip. We honour it but allow the
    // panel to extend to multi-kind (kindMask is the richer surface).
    if (s.mode === 'vertex') _state.kindMask = { vertex: true, edge: false, face: false, grid: false };
    else if (s.mode === 'edge') _state.kindMask = { vertex: false, edge: true, face: false, grid: false };
    else if (s.mode === 'face') _state.kindMask = { vertex: false, edge: false, face: true, grid: false };
    else if (s.mode === 'grid') _state.kindMask = { vertex: false, edge: false, face: false, grid: true };
  }
}

// Geometry helpers -----------------------------------------------------
function _cacheFor(mesh) {
  if (!mesh.geometry || !mesh.geometry.attributes || !mesh.geometry.attributes.position) return null;
  const pos = mesh.geometry.attributes.position;
  const idx = mesh.geometry.index ? mesh.geometry.index.array : null;
  const stamp = pos.version;
  let entry = _state._cache.get(mesh);
  if (entry && entry.stamp === stamp) return entry;
  // Build local-space arrays (apply matrixWorld lazily in worker step
  // below to keep this cache cheap).
  const verts = [];
  for (let i = 0; i < pos.count; i++) {
    verts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  const edges = [];
  const faces = [];
  if (idx) {
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      // Edge midpoints (a-b, b-c, c-a) — dedup not required for snap
      edges.push((verts[a] + verts[b]) / 2, (verts[a + 1] + verts[b + 1]) / 2, (verts[a + 2] + verts[b + 2]) / 2);
      edges.push((verts[b] + verts[c]) / 2, (verts[b + 1] + verts[c + 1]) / 2, (verts[b + 2] + verts[c + 2]) / 2);
      edges.push((verts[c] + verts[a]) / 2, (verts[c + 1] + verts[a + 1]) / 2, (verts[c + 2] + verts[a + 2]) / 2);
      // Face centroid
      faces.push(
        (verts[a] + verts[b] + verts[c]) / 3,
        (verts[a + 1] + verts[b + 1] + verts[c + 1]) / 3,
        (verts[a + 2] + verts[b + 2] + verts[c + 2]) / 3,
      );
    }
  }
  entry = { stamp, verts, edges, faces };
  _state._cache.set(mesh, entry);
  return entry;
}

// Find the nearest snap candidate to `worldPos` across every primitive
// mesh in the scene (excluding `excludeMesh`). Returns the best result
// plus its distance — caller decides whether it beats grid.
function _findGeometryCandidate(worldPos, excludeMesh) {
  const scene = (typeof window !== 'undefined') ? window.__archdiscScene : null;
  if (!scene) return null;
  const tmp = new THREE.Vector3();
  const probe = new THREE.Vector3();
  let best = null;
  const r2 = _state.snapRadius * _state.snapRadius;
  const consider = (kind, arr, mesh) => {
    if (!arr || !arr.length) return;
    mesh.updateMatrixWorld(false);
    const m = mesh.matrixWorld;
    for (let i = 0; i < arr.length; i += 3) {
      probe.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(m);
      const dx = probe.x - worldPos.x;
      const dy = probe.y - worldPos.y;
      const dz = probe.z - worldPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= r2 && (!best || d2 < best.d2)) {
        best = {
          kind,
          point: [probe.x, probe.y, probe.z],
          d2,
          distance: Math.sqrt(d2),
          meshUuid: mesh.uuid,
        };
      }
    }
  };
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (o === excludeMesh) return;
    if (!o.userData || !o.userData.archdiscStudioPrimitive) return;
    const cache = _cacheFor(o);
    if (!cache) return;
    if (_state.kindMask.vertex) consider('vertex', cache.verts, o);
    if (_state.kindMask.edge)   consider('edge',   cache.edges, o);
    if (_state.kindMask.face)   consider('face',   cache.faces, o);
  });
  return best;
}

function _findGridCandidate(worldPos) {
  if (!_state.kindMask.grid) return null;
  const g = _state.gridSize;
  if (!(g > 0)) return null;
  const sx = Math.round(worldPos.x / g) * g;
  const sy = Math.round(worldPos.y / g) * g;
  const sz = Math.round(worldPos.z / g) * g;
  const dx = sx - worldPos.x, dy = sy - worldPos.y, dz = sz - worldPos.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > _state.snapRadius * _state.snapRadius) return null;
  return { kind: 'grid', point: [sx, sy, sz], d2, distance: Math.sqrt(d2), meshUuid: null };
}

// Step function — called once per pointermove while a drag is active.
// Exposed so tests can drive it deterministically without faking
// pointer events.
export function stepSnap() {
  if (!_state.liveDragOn) return { ok: false, reason: 'live-drag off' };
  if (!_state.dragging) return { ok: false, reason: 'not dragging' };
  const mesh = _state.attachedMesh;
  if (!mesh) return { ok: false, reason: 'no mesh' };
  syncFromSliceState();
  // Use the mesh's current world position as the snap "from" point —
  // TransformControls has already applied this frame's cursor delta to
  // mesh.position by the time we run.
  mesh.updateMatrixWorld(true);
  const from = new THREE.Vector3();
  mesh.getWorldPosition(from);
  const geomBest = _findGeometryCandidate(from, mesh);
  const gridBest = _findGridCandidate(from);
  let pick = null;
  if (geomBest && gridBest) pick = geomBest.d2 <= gridBest.d2 ? geomBest : gridBest;
  else pick = geomBest || gridBest;
  if (!pick) { _state.lastSnap = null; return { ok: true, snapped: false }; }
  // Convert snap-point back into the mesh's parent local space.
  const target = new THREE.Vector3(pick.point[0], pick.point[1], pick.point[2]);
  if (mesh.parent) {
    mesh.parent.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(mesh.parent.matrixWorld).invert();
    target.applyMatrix4(inv);
  }
  mesh.position.copy(target);
  mesh.updateMatrixWorld(true);
  _state.lastSnap = {
    kind: pick.kind,
    point: pick.point,
    distance: pick.distance,
    meshUuid: pick.meshUuid,
    appliedTo: mesh.uuid,
    at: Date.now(),
  };
  // Bump TransformControls so its gizmo helper repositions to the
  // snapped location (otherwise the gizmo lags by one frame).
  try {
    const v = window.__archdiscViewport;
    if (v && v.transformControls && typeof v.transformControls.dispatchEvent === 'function') {
      v.transformControls.dispatchEvent({ type: 'change' });
    }
  } catch (_) { /* ignore */ }
  return { ok: true, snapped: true, ..._state.lastSnap };
}

// Listener wiring ------------------------------------------------------
function _resolveGizmo() {
  const v = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  return (v && v.transformControls) || null;
}

function _attachDragWatch() {
  const g = _resolveGizmo();
  if (!g || _state._gizmoRef === g) return;
  _state._gizmoRef = g;
  const onDragging = (e) => {
    _state.dragging = !!e.value;
    if (_state.dragging) {
      _state.attachedMesh = g.object || null;
    } else {
      _state.attachedMesh = null;
      _state.lastSnap = null;
    }
  };
  try {
    g.addEventListener('dragging-changed', onDragging);
    _state._onDragging = onDragging;
  } catch (_) { /* gizmo may not be EventDispatcher yet */ }
}

function _pointerHandler() {
  if (!_state.liveDragOn) return;
  if (!_state.dragging) return;
  // _attachDragWatch is idempotent — re-call in case the viewport was
  // mounted after install (dev-server cold start).
  _attachDragWatch();
  try { stepSnap(); } catch (_) { /* swallow per-frame errors */ }
}

export function setLiveDrag(on) {
  _state.liveDragOn = !!on;
  if (_state.liveDragOn && typeof window !== 'undefined' && !_state._onPointer) {
    _state._onPointer = _pointerHandler;
    window.addEventListener('pointermove', _state._onPointer, true);
    // Best-effort gizmo subscribe — also tried lazily on first move.
    _attachDragWatch();
  } else if (!_state.liveDragOn && _state._onPointer) {
    try { window.removeEventListener('pointermove', _state._onPointer, true); } catch (_) {}
    _state._onPointer = null;
  }
  return { ok: true, on: _state.liveDragOn };
}

export function setSnapRadius(r) {
  const v = Math.max(1e-5, Math.min(10, Number(r) || 0));
  _state.snapRadius = v;
  return { ok: true, snapRadius: v };
}

export function setKindMask(mask) {
  if (mask && typeof mask === 'object') {
    if ('vertex' in mask) _state.kindMask.vertex = !!mask.vertex;
    if ('edge'   in mask) _state.kindMask.edge   = !!mask.edge;
    if ('face'   in mask) _state.kindMask.face   = !!mask.face;
    if ('grid'   in mask) _state.kindMask.grid   = !!mask.grid;
  }
  return { ok: true, mask: { ..._state.kindMask } };
}

export function setGridSize(g) {
  const v = Math.max(1e-5, Math.min(10, Number(g) || 0));
  _state.gridSize = v;
  return { ok: true, gridSize: v };
}

export function getState() {
  return {
    ok: true,
    on: _state.liveDragOn,
    snapRadius: _state.snapRadius,
    gridSize: _state.gridSize,
    kindMask: { ..._state.kindMask },
    dragging: _state.dragging,
    attachedUuid: _state.attachedMesh ? _state.attachedMesh.uuid : null,
    lastSnap: _state.lastSnap ? { ..._state.lastSnap } : null,
  };
}

export function teardown() {
  setLiveDrag(false);
  if (_state._gizmoRef && _state._onDragging) {
    try { _state._gizmoRef.removeEventListener('dragging-changed', _state._onDragging); } catch (_) {}
  }
  _state._gizmoRef = null;
  _state._onDragging = null;
  _state.dragging = false;
  _state.attachedMesh = null;
  _state.lastSnap = null;
  return { ok: true };
}

export function install() {
  if (_state.installed) return { ok: true, already: true };
  _state.installed = true;
  // Don't auto-enable — let the caller flip via setLiveDrag(true).
  return { ok: true };
}
