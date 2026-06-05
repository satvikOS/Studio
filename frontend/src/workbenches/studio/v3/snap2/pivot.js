// ArchDisc Studio V3 — Pivot point.
//
// Blender's "Pivot Point" popover. Affects where rotations and scales
// are anchored on a multi-selection. Kinds:
//
// • bbox       — bounding-box centre of the selection (axis-aligned)
// • median     — arithmetic mean of every member's origin
// • individual — each member transforms around its own origin (gizmo
//                still appears at the active member, but each mesh
//                receives a copy of the delta applied at its own origin)
// • active     — the active (last-selected) member's origin
// • cursor     — the scene's 3D cursor (window.__archdiscCursorWorld)
//
// Implementation:
// 1. We expose `setPivot(kind)` / `getPivot()` ops + a pure
//    `computePivot(meshes, kind)` helper.
// 2. On every TransformControls `change` event we read the current
//    pivot kind, recompute the desired pivot world position, and
//    snap the gizmo helper to that point (without moving the meshes).
// 3. When the user finishes a drag (`mouseUp` / `dragging-changed →
//    false`) we replay the recorded delta around the pivot to every
//    other selected mesh. The active mesh has already been moved by
//    TransformControls in-place.
// 4. The `individual` kind is special: we capture each mesh's local
//    pre-drag transform, then on each change event re-apply the gizmo
//    delta to every selected mesh around its own origin.
//
// The slice 655 single-mesh selection still works exactly as before —
// pivot only matters when `window.__studioSelectedMeshesSet` has >1
// member.

import * as THREE from 'three';

const VALID = ['bbox', 'median', 'individual', 'active', 'cursor'];

const _state = {
  kind: 'median',
  // Per-drag bookkeeping
  _baselines: null,     // Map<mesh, { pos:Vector3, quat:Quaternion, scale:Vector3, worldPos:Vector3 }>
  _pivotWorld: null,    // Vector3 the gizmo is anchored at this drag
  _gizmoSubbed: false,
  _onChange: null,
  _onDragging: null,
  _activeMesh: null,
};

function _selection() {
  if (typeof window === 'undefined') return [];
  const set = Array.isArray(window.__studioSelectedMeshesSet)
    ? window.__studioSelectedMeshesSet.filter((m) => m && m.isMesh)
    : [];
  if (set.length) return set;
  const single = (typeof window.__studioSelectedMesh === 'function') ? window.__studioSelectedMesh() : null;
  return single ? [single] : [];
}

function _cursor() {
  if (typeof window === 'undefined') return new THREE.Vector3(0, 0, 0);
  const c = window.__archdiscCursorWorld;
  if (Array.isArray(c) && c.length === 3) return new THREE.Vector3(c[0], c[1], c[2]);
  if (c && typeof c.x === 'number') return new THREE.Vector3(c.x, c.y, c.z);
  return new THREE.Vector3(0, 0, 0);
}

function _tc() {
  const v = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  return (v && v.transformControls) || null;
}

// Pure helper — used by tests + by the gizmo change handler.
export function computePivot(meshes, kind) {
  const list = Array.isArray(meshes) ? meshes.filter(Boolean) : [];
  if (!list.length) return new THREE.Vector3(0, 0, 0);
  if (kind === 'bbox') {
    const box = new THREE.Box3();
    for (const m of list) {
      m.updateMatrixWorld(true);
      box.expandByObject(m);
    }
    const c = new THREE.Vector3();
    box.getCenter(c);
    return c;
  }
  if (kind === 'median') {
    const sum = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    for (const m of list) {
      m.updateMatrixWorld(true);
      m.getWorldPosition(tmp);
      sum.add(tmp);
    }
    sum.multiplyScalar(1 / list.length);
    return sum;
  }
  if (kind === 'active') {
    const active = list[list.length - 1];
    active.updateMatrixWorld(true);
    return active.getWorldPosition(new THREE.Vector3());
  }
  if (kind === 'individual') {
    // Per-mesh pivot — represented as a per-mesh position. The shared
    // gizmo still needs *some* anchor; we use the active member.
    const active = list[list.length - 1];
    active.updateMatrixWorld(true);
    return active.getWorldPosition(new THREE.Vector3());
  }
  if (kind === 'cursor') return _cursor();
  // Fallback
  return new THREE.Vector3(0, 0, 0);
}

function _captureBaselines(meshes) {
  const out = new Map();
  for (const m of meshes) {
    m.updateMatrixWorld(true);
    out.set(m, {
      pos:   m.position.clone(),
      quat:  m.quaternion.clone(),
      scale: m.scale.clone(),
      worldPos: m.getWorldPosition(new THREE.Vector3()),
      worldQuat: m.getWorldQuaternion(new THREE.Quaternion()),
      worldScale: m.getWorldScale(new THREE.Vector3()),
    });
  }
  return out;
}

function _ensureHook() {
  if (_state._gizmoSubbed) return;
  const tc = _tc();
  if (!tc) return;
  _state._gizmoSubbed = true;

  _state._onDragging = (e) => {
    const sel = _selection();
    if (e.value) {
      _state._baselines = _captureBaselines(sel);
      _state._activeMesh = tc.object || null;
      _state._pivotWorld = computePivot(sel, _state.kind);
    } else {
      _state._baselines = null;
      _state._activeMesh = null;
      _state._pivotWorld = null;
    }
  };
  tc.addEventListener('dragging-changed', _state._onDragging);

  _state._onChange = () => {
    if (!_state._baselines) return;
    const active = _state._activeMesh;
    if (!active) return;
    const baseActive = _state._baselines.get(active);
    if (!baseActive) return;
    // Compute the delta applied by TransformControls to the active mesh.
    active.updateMatrixWorld(true);
    const curWorldPos   = active.getWorldPosition(new THREE.Vector3());
    const curWorldQuat  = active.getWorldQuaternion(new THREE.Quaternion());
    const curWorldScale = active.getWorldScale(new THREE.Vector3());

    const dPos = new THREE.Vector3().subVectors(curWorldPos, baseActive.worldPos);
    const dQuat = new THREE.Quaternion().multiplyQuaternions(curWorldQuat, baseActive.worldQuat.clone().invert());
    const dScale = new THREE.Vector3(
      curWorldScale.x / Math.max(1e-12, baseActive.worldScale.x),
      curWorldScale.y / Math.max(1e-12, baseActive.worldScale.y),
      curWorldScale.z / Math.max(1e-12, baseActive.worldScale.z),
    );

    if (_state.kind === 'individual') {
      // Each mesh rotates/scales around its own origin; translation
      // is shared.
      for (const [m, base] of _state._baselines) {
        if (m === active) continue;
        // Translate by dPos
        const newWP = base.worldPos.clone().add(dPos);
        // Rotate around own origin
        const newWQ = dQuat.clone().multiply(base.worldQuat);
        // Scale per-axis
        const newWS = new THREE.Vector3(
          base.worldScale.x * dScale.x,
          base.worldScale.y * dScale.y,
          base.worldScale.z * dScale.z,
        );
        _applyWorld(m, newWP, newWQ, newWS);
      }
    } else {
      // Pivot-anchored transform: each mesh rotates/scales around the
      // shared pivot.
      const pivot = _state._pivotWorld || baseActive.worldPos;
      for (const [m, base] of _state._baselines) {
        if (m === active) continue;
        // Offset from pivot in baseline world space
        const off = new THREE.Vector3().subVectors(base.worldPos, pivot);
        // Apply rotation + scale to offset
        off.applyQuaternion(dQuat);
        off.multiply(dScale);
        const newWP = new THREE.Vector3().addVectors(pivot, off).add(dPos);
        const newWQ = dQuat.clone().multiply(base.worldQuat);
        const newWS = new THREE.Vector3(
          base.worldScale.x * dScale.x,
          base.worldScale.y * dScale.y,
          base.worldScale.z * dScale.z,
        );
        _applyWorld(m, newWP, newWQ, newWS);
      }
    }
  };
  tc.addEventListener('change', _state._onChange);
}

function _applyWorld(mesh, wp, wq, ws) {
  if (mesh.parent) {
    mesh.parent.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(mesh.parent.matrixWorld).invert();
    const wm = new THREE.Matrix4().compose(wp, wq, ws);
    const lm = new THREE.Matrix4().multiplyMatrices(inv, wm);
    lm.decompose(mesh.position, mesh.quaternion, mesh.scale);
  } else {
    mesh.position.copy(wp);
    mesh.quaternion.copy(wq);
    mesh.scale.copy(ws);
  }
  mesh.updateMatrixWorld(true);
}

export function setPivot(kind) {
  if (!VALID.includes(kind)) return { ok: false, valid: VALID };
  _state.kind = kind;
  _ensureHook();
  return { ok: true, kind };
}

export function getPivot() {
  return { ok: true, kind: _state.kind, valid: VALID.slice() };
}

export function install() {
  _ensureHook();
  return { ok: true };
}

export function teardown() {
  const tc = _tc();
  if (tc) {
    if (_state._onDragging) { try { tc.removeEventListener('dragging-changed', _state._onDragging); } catch (_) {} }
    if (_state._onChange)   { try { tc.removeEventListener('change', _state._onChange); } catch (_) {} }
  }
  _state._gizmoSubbed = false;
  _state._onDragging = null;
  _state._onChange = null;
  _state._baselines = null;
  _state._activeMesh = null;
  _state._pivotWorld = null;
  return { ok: true };
}
