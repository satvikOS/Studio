// ArchDisc Studio V3 — IK handle pointer drag.
//
// Hooks pointerdown / pointermove / pointerup on the viewport canvas
// (window.__archdiscViewport.renderer.domElement). On pointerdown we
// raycast against every handle mesh (tagged userData.archdiscStudioIKHandle)
// in the scene. On hit we:
//
//   • disable orbitControls so the drag doesn't orbit the camera
//   • cache a drag plane perpendicular to the camera at the bone's
//     world position (so the handle slides naturally in screen space
//     instead of jumping to a wildly different depth)
//   • on every pointermove, project the new pointer ray onto that
//     plane and call dragHandle(handleUuid, newWorldPos) — which moves
//     the sphere AND runs the CCD IK solver against the bone chain
//   • on pointerup, re-enable orbitControls
//
// Idempotent: install() / uninstall() can be called repeatedly. The
// listener is bound once per viewport DOM element; we remember the
// (renderer DOM, listener) pair so uninstall removes the exact handler.
//
// Tests can call into the drag path two ways:
//   - programmatic: window.__studioRigUIDragHandle(uuid, [x,y,z])
//   - synthetic events: dispatch real pointer events on the canvas;
//     the spec covers both for full hit-test + plane-projection coverage.

import * as THREE from 'three';
import { dragHandle, __internal as hInt } from './handles.js';

const _state = {
  installed: false,
  dom: null,           // the renderer.domElement we bound to
  onDown: null,
  onMove: null,
  onUp: null,
  // Active drag bookkeeping
  active: null,        // { handleUuid, plane: THREE.Plane, orbit, pointerId }
  raycaster: new THREE.Raycaster(),
  ndc: new THREE.Vector2(),
  hit: new THREE.Vector3(),
  // Allow tests + auto-init to find an installed viewport even when the
  // renderer is created AFTER our install() call: we re-probe lazily on
  // every pointer event if we haven't found a DOM yet.
};

function getViewport() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscViewport || null;
}

function getDom() {
  const vp = getViewport();
  if (!vp) return null;
  if (vp.renderer && vp.renderer.domElement) return vp.renderer.domElement;
  return null;
}

function getCamera() {
  const vp = getViewport();
  return (vp && vp.camera) || null;
}

function getOrbit() {
  const vp = getViewport();
  return (vp && vp.orbitControls) || null;
}

function getScene() {
  return hInt.getScene();
}

function setNdcFromEvent(ev, dom) {
  const r = dom.getBoundingClientRect();
  // Guard against a 0-sized rect (e.g. a hidden viewport during setup).
  const w = r.width > 0 ? r.width : 1;
  const h = r.height > 0 ? r.height : 1;
  _state.ndc.x = ((ev.clientX - r.left) / w) * 2 - 1;
  _state.ndc.y = -((ev.clientY - r.top) / h) * 2 + 1;
}

function pickHandle(ev) {
  const dom = getDom();
  const cam = getCamera();
  const scene = getScene();
  if (!dom || !cam || !scene) return null;
  setNdcFromEvent(ev, dom);
  _state.raycaster.setFromCamera(_state.ndc, cam);
  const handles = [];
  scene.traverse((o) => {
    if (!o.userData || !o.userData[hInt.HANDLE_TAG]) return;
    handles.push(o);
  });
  if (!handles.length) return null;
  const hits = _state.raycaster.intersectObjects(handles, false);
  return hits.length ? hits[0].object : null;
}

function planeFromCameraAt(point) {
  const cam = getCamera();
  if (!cam) return new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  // Plane normal = camera-forward direction, so the handle slides in
  // a plane perpendicular to the view. setFromNormalAndCoplanarPoint
  // places it exactly through the bone's current position.
  const n = new THREE.Vector3();
  cam.getWorldDirection(n);
  // getWorldDirection returns -Z in world space (camera looks down -Z).
  // For a Plane we want a normal pointing AT the camera so positive d
  // = "behind plane"; either orientation works for raycaster.ray.intersectPlane
  // because the ray will hit the plane regardless of normal sign, so we
  // keep the camera-forward as-is.
  return new THREE.Plane().setFromNormalAndCoplanarPoint(n, point);
}

function projectToPlane(ev, plane) {
  const dom = getDom();
  const cam = getCamera();
  if (!dom || !cam) return null;
  setNdcFromEvent(ev, dom);
  _state.raycaster.setFromCamera(_state.ndc, cam);
  const out = new THREE.Vector3();
  const hit = _state.raycaster.ray.intersectPlane(plane, out);
  return hit ? [out.x, out.y, out.z] : null;
}

function onDown(ev) {
  // Left mouse / primary touch only.
  if (ev.button != null && ev.button !== 0) return;
  const handle = pickHandle(ev);
  if (!handle) return;
  const tag = handle.userData[hInt.HANDLE_TAG];
  const bone = hInt.findBone(tag.boneUuid);
  if (!bone) return;
  const wp = new THREE.Vector3();
  bone.getWorldPosition(wp);

  const orbit = getOrbit();
  const prevOrbitEnabled = orbit ? !!orbit.enabled : null;
  if (orbit) orbit.enabled = false;

  _state.active = {
    handleUuid: handle.uuid,
    boneUuid: tag.boneUuid,
    plane: planeFromCameraAt(wp),
    orbit,
    prevOrbitEnabled,
    pointerId: ev.pointerId != null ? ev.pointerId : null,
  };

  // Capture the pointer so we keep getting move events even if the
  // cursor leaves the canvas. Guarded — JSDOM-style envs don't always
  // implement setPointerCapture.
  try {
    if (_state.active.pointerId != null && typeof ev.target.setPointerCapture === 'function') {
      ev.target.setPointerCapture(_state.active.pointerId);
    }
  } catch (_) {}

  ev.preventDefault();
  ev.stopPropagation();
}

function onMove(ev) {
  if (!_state.active) return;
  const target = projectToPlane(ev, _state.active.plane);
  if (!target) return;
  // dragHandle moves the sphere AND runs the IK solver in one call.
  dragHandle(_state.active.handleUuid, target);
  ev.preventDefault();
}

function onUp(ev) {
  if (!_state.active) return;
  const a = _state.active;
  _state.active = null;
  if (a.orbit) a.orbit.enabled = a.prevOrbitEnabled == null ? true : a.prevOrbitEnabled;
  try {
    if (a.pointerId != null && ev && ev.target && typeof ev.target.releasePointerCapture === 'function') {
      ev.target.releasePointerCapture(a.pointerId);
    }
  } catch (_) {}
}

export function install() {
  if (_state.installed) return { ok: true, alreadyInstalled: true };
  const dom = getDom();
  if (!dom) {
    // Viewport hasn't mounted yet; caller can retry later. We don't
    // throw so the rig UI op surface is still registered.
    return { ok: false, error: 'no viewport canvas' };
  }
  _state.onDown = onDown;
  _state.onMove = onMove;
  _state.onUp = onUp;
  // Pointer events at capture phase so we beat the orbit-controls
  // listener (it binds at bubble phase on the same element).
  dom.addEventListener('pointerdown', _state.onDown, true);
  // Move + up on window so a drag that leaves the canvas still tracks.
  window.addEventListener('pointermove', _state.onMove, true);
  window.addEventListener('pointerup', _state.onUp, true);
  window.addEventListener('pointercancel', _state.onUp, true);
  _state.dom = dom;
  _state.installed = true;
  return { ok: true };
}

export function uninstall() {
  if (!_state.installed) return { ok: true, alreadyUninstalled: true };
  if (_state.dom) {
    try { _state.dom.removeEventListener('pointerdown', _state.onDown, true); } catch (_) {}
  }
  try { window.removeEventListener('pointermove', _state.onMove, true); } catch (_) {}
  try { window.removeEventListener('pointerup', _state.onUp, true); } catch (_) {}
  try { window.removeEventListener('pointercancel', _state.onUp, true); } catch (_) {}
  // If an active drag is in flight, restore orbit.
  if (_state.active && _state.active.orbit) {
    _state.active.orbit.enabled = _state.active.prevOrbitEnabled == null ? true : _state.active.prevOrbitEnabled;
  }
  _state.active = null;
  _state.dom = null;
  _state.installed = false;
  return { ok: true };
}

export function isInstalled() {
  return _state.installed;
}

// For tests / debugging — read-only.
export function _state_snapshot() {
  return {
    installed: _state.installed,
    domAttached: !!_state.dom,
    activeHandle: _state.active && _state.active.handleUuid,
  };
}
