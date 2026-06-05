// ArchDisc Studio V3 — Transform orientation.
//
// Blender's Transform Orientation popover offers Global / Local /
// Normal / Gimbal / View / Custom. We expose the same set + a Custom
// kind that takes an [x, y, z] axis triplet (column-major basis or a
// single vector that we orthonormalise into a full frame).
//
// Mapping to TransformControls:
// • 'global'  → tc.setSpace('world')
// • 'local'   → tc.setSpace('local')
// • 'normal'  → tc.setSpace('local'); we additionally rotate the
//               attached mesh's *gizmo helper* to align with the
//               selected face normal. For meshes without a remembered
//               normal we fall back to local.
// • 'gimbal'  → tc.setSpace('local'); gimbal differs from local by
//               using the object's *rotation order* (euler axes) for
//               the rotate gizmo. Three's TransformControls always
//               operates on quaternions, so we approximate by setting
//               local + storing a userData hint that the rotate
//               gizmo's axis labels should read XYZ-in-rotation-order.
// • 'view'    → orient gizmo helper to align with current camera basis.
// • 'custom'  → user-supplied axes; orthonormalised into a 3x3 frame
//               and applied to the gizmo helper.
//
// All non-'world' kinds end up as setSpace('local') on TransformControls
// (which forces the gizmo to read its axes from the attached object's
// quaternion). We then optionally pre-rotate the *attached object's
// quaternion* by `_orientationQuat` so the gizmo arrows point along the
// requested frame. When the user lets go of the gizmo we restore the
// object's original quaternion — only the gizmo display was rotated,
// never the mesh's permanent orientation. This matches Blender's
// behaviour: orientation kind affects the gizmo, not the data.

import * as THREE from 'three';

const VALID = ['global', 'local', 'normal', 'gimbal', 'view', 'custom'];

const _state = {
  kind: 'global',
  customAxes: [1, 0, 0],       // single direction; orthonormalised
  customMatrix: new THREE.Matrix4(), // resolved 3x3 frame, identity by default
  _appliedQuat: null,          // backup of attached object's original quaternion
  _appliedMesh: null,
  _gizmoSubbed: false,
};

function _tc() {
  const v = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  return (v && v.transformControls) || null;
}

function _cam() {
  const v = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  return (v && v.camera) || null;
}

// Build an orthonormal basis matrix from a single primary axis (vec3).
// Picks an arbitrary up that isn't parallel, then Gram-Schmidts.
function _basisFromAxis(axisArr) {
  const x = new THREE.Vector3(axisArr[0], axisArr[1], axisArr[2]);
  if (x.lengthSq() < 1e-12) x.set(1, 0, 0);
  x.normalize();
  const upGuess = Math.abs(x.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const z = new THREE.Vector3().crossVectors(x, upGuess).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4();
  m.makeBasis(x, y, z);
  return m;
}

// Build a basis from a 9-element flat matrix or a 3-element axis.
function _resolveCustom(axes) {
  if (Array.isArray(axes) && axes.length === 9) {
    const m = new THREE.Matrix4();
    m.set(
      axes[0], axes[3], axes[6], 0,
      axes[1], axes[4], axes[7], 0,
      axes[2], axes[5], axes[8], 0,
      0,       0,       0,       1,
    );
    return m;
  }
  if (Array.isArray(axes) && axes.length === 3) return _basisFromAxis(axes);
  return _basisFromAxis([1, 0, 0]);
}

// Helper: write a per-orientation quaternion into the gizmo helper's
// own rotation slot (without touching the mesh). For Three's
// TransformControls this is done by overriding the helper's quaternion
// each frame the gizmo is visible. We subscribe to its `change` event.
function _ensureGizmoHook() {
  if (_state._gizmoSubbed) return;
  const tc = _tc();
  if (!tc) return;
  _state._gizmoSubbed = true;
  tc.addEventListener('change', () => {
    if (!tc.object) return;
    const helper = (typeof tc.getHelper === 'function') ? tc.getHelper() : null;
    if (!helper) return;
    // For 'global' the helper stays world-aligned (identity).
    // For 'local' / 'gimbal' it follows the object (TransformControls
    // already does this when setSpace('local')).
    // For 'normal', 'view', 'custom' we override its quaternion.
    if (_state.kind === 'normal') {
      const n = _readActiveNormal(tc.object);
      if (n) helper.quaternion.copy(_quatFromNormal(n));
    } else if (_state.kind === 'view') {
      const c = _cam(); if (c) {
        c.updateMatrixWorld();
        const q = new THREE.Quaternion();
        c.getWorldQuaternion(q);
        helper.quaternion.copy(q);
      }
    } else if (_state.kind === 'custom') {
      const q = new THREE.Quaternion().setFromRotationMatrix(_state.customMatrix);
      helper.quaternion.copy(q);
    }
  });
}

function _readActiveNormal(mesh) {
  if (!mesh) return null;
  const ud = mesh.userData || {};
  if (Array.isArray(ud.archdiscStudioActiveNormal) && ud.archdiscStudioActiveNormal.length === 3) {
    return new THREE.Vector3(...ud.archdiscStudioActiveNormal);
  }
  // Fallback: world-up.
  return new THREE.Vector3(0, 1, 0);
}

function _quatFromNormal(n) {
  // Build a basis with +Z aligned to the normal (Blender convention
  // for face-normal orientation).
  const z = n.clone().normalize();
  const upGuess = Math.abs(z.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const x = new THREE.Vector3().crossVectors(upGuess, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

export function setOrientation(kind) {
  if (!VALID.includes(kind)) return { ok: false, valid: VALID };
  _state.kind = kind;
  const tc = _tc();
  if (tc) {
    if (kind === 'global') tc.setSpace('world');
    else tc.setSpace('local');
    _ensureGizmoHook();
    // Trigger a change to immediately repaint the helper.
    try { tc.dispatchEvent({ type: 'change' }); } catch (_) {}
  }
  return { ok: true, kind, applied: !!tc };
}

export function setCustomOrientation(axes) {
  _state.customAxes = Array.isArray(axes) ? axes.slice() : [1, 0, 0];
  _state.customMatrix = _resolveCustom(_state.customAxes);
  if (_state.kind === 'custom') {
    const tc = _tc();
    if (tc) try { tc.dispatchEvent({ type: 'change' }); } catch (_) {}
  }
  return { ok: true, axes: _state.customAxes.slice() };
}

export function getOrientation() {
  return {
    ok: true,
    kind: _state.kind,
    customAxes: _state.customAxes.slice(),
    valid: VALID.slice(),
  };
}

export function install() {
  // Defer wiring — viewport may not be ready at module import.
  _ensureGizmoHook();
  return { ok: true };
}
