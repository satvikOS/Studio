// ArchDisc Studio V3 — Grease Pencil Draw projection helpers.
//
// `projectScreenToDrawPlane(x, y, mode)` converts a (pixelX, pixelY)
// canvas-relative pointer position into a world-space THREE.Vector3
// on the requested draw surface.
//
// Modes:
//   'xy'      — plane at z = 0 with normal +Z
//   'xz'      — plane at y = 0 with normal +Y  (ground plane)
//   'yz'      — plane at x = 0 with normal +X
//   'screen'  — view-aligned plane passing through the orbit-controls
//               target (or scene origin), normal = -camera.forward.
//               Lets users sketch in the air at the current pivot.
//   'surface' — raycast every scene mesh (excluding Studio gizmos /
//               grid / ground / existing GP strokes). Falls back to
//               'xz' when nothing is hit.
//
// Returns `{ ok, point: THREE.Vector3, hit: { uuid, distance }? }`
// or `{ ok: false, error }` when the viewport isn't ready.
//
// Pure projection — no DOM manipulation, no listeners. The dragger
// module composes this with pointer events.

import * as THREE from 'three';
import { closestHit, ndcFromPixel } from '../common/raycast.js';

function _vp() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscViewport || null;
}

// Cache reusable scratch objects so we don't churn the GC during a
// long drag (pointermove fires per-pixel on a hi-DPI display).
const _scratchRay = new THREE.Raycaster();
const _scratchPlane = new THREE.Plane();
const _scratchHit = new THREE.Vector3();
const _scratchNormal = new THREE.Vector3();

/**
 * @param {number} pixelX  canvas-relative pixel X
 * @param {number} pixelY  canvas-relative pixel Y
 * @param {string} mode    one of 'xy' | 'xz' | 'yz' | 'screen' | 'surface'
 * @returns {{ ok: boolean, point?: THREE.Vector3, hit?: object, error?: string, mode: string }}
 */
export function projectScreenToDrawPlane(pixelX, pixelY, mode) {
  const m = _normMode(mode);
  const vp = _vp();
  if (!vp || !vp.camera || !vp.renderer) {
    return { ok: false, error: 'no viewport', mode: m };
  }

  // 'surface' delegates to the shared raycast helper so we share the
  // same gizmo / grid / ground filters as every other Studio picker.
  if (m === 'surface') {
    const r = closestHit(pixelX, pixelY, (o) => {
      if (!o.isMesh) return false;
      if (!o.visible) return false;
      const u = o.userData || {};
      if (u.archdiscStudioGizmo) return false;
      if (u.archdiscStudioGrid) return false;
      if (u.archdiscStudioGround) return false;
      // Don't snap to our own freshly-drawn strokes — would compound
      // the radius into thicker and thicker tubes.
      if (u.archdiscStudioGP) return false;
      return true;
    });
    if (r && r.ok && r.hit) {
      return {
        ok: true,
        mode: m,
        point: new THREE.Vector3(r.hit.point[0], r.hit.point[1], r.hit.point[2]),
        hit: { uuid: r.hit.uuid, distance: r.hit.distance },
      };
    }
    // Fall through to xz ground plane.
    return _projectAxisPlane(pixelX, pixelY, 'xz');
  }

  if (m === 'screen') {
    return _projectScreenAligned(pixelX, pixelY);
  }

  return _projectAxisPlane(pixelX, pixelY, m);
}

// ─── Axis-aligned plane intersection ────────────────────────────────
function _projectAxisPlane(pixelX, pixelY, mode) {
  const vp = _vp();
  const nd = ndcFromPixel(pixelX, pixelY);
  if (!nd.ok) return { ok: false, error: 'no ndc', mode };
  _scratchRay.setFromCamera({ x: nd.x, y: nd.y }, vp.camera);

  // Pick the plane that the mode picks out.
  //   'xy' → z = 0  (normal +Z)
  //   'xz' → y = 0  (normal +Y, ground)
  //   'yz' → x = 0  (normal +X)
  if (mode === 'xy') {
    _scratchNormal.set(0, 0, 1);
  } else if (mode === 'yz') {
    _scratchNormal.set(1, 0, 0);
  } else {
    _scratchNormal.set(0, 1, 0); // 'xz' default
  }
  _scratchPlane.setFromNormalAndCoplanarPoint(_scratchNormal, new THREE.Vector3(0, 0, 0));

  if (!_scratchRay.ray.intersectPlane(_scratchPlane, _scratchHit)) {
    return { ok: false, error: 'ray parallel', mode };
  }
  return {
    ok: true,
    mode,
    point: new THREE.Vector3(_scratchHit.x, _scratchHit.y, _scratchHit.z),
  };
}

// ─── View-aligned plane (passes through orbit target / origin) ──────
function _projectScreenAligned(pixelX, pixelY) {
  const vp = _vp();
  const nd = ndcFromPixel(pixelX, pixelY);
  if (!nd.ok) return { ok: false, error: 'no ndc', mode: 'screen' };
  _scratchRay.setFromCamera({ x: nd.x, y: nd.y }, vp.camera);

  // Pivot point — orbit-controls target if present, otherwise origin.
  const target = (vp.orbitControls && vp.orbitControls.target)
    ? vp.orbitControls.target.clone()
    : new THREE.Vector3(0, 0, 0);

  // Plane normal — pointing back along the camera forward axis.
  vp.camera.getWorldDirection(_scratchNormal);
  _scratchNormal.negate();
  _scratchPlane.setFromNormalAndCoplanarPoint(_scratchNormal, target);

  if (!_scratchRay.ray.intersectPlane(_scratchPlane, _scratchHit)) {
    return { ok: false, error: 'ray parallel', mode: 'screen' };
  }
  return {
    ok: true,
    mode: 'screen',
    point: new THREE.Vector3(_scratchHit.x, _scratchHit.y, _scratchHit.z),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────
function _normMode(m) {
  const s = String(m || 'xz').toLowerCase().trim();
  if (s === 'xy' || s === 'xz' || s === 'yz' || s === 'screen' || s === 'surface') return s;
  return 'xz';
}

// Test helper — convert client (page) coordinates to canvas-relative
// pixels using the renderer's bounding rect. The dragger passes
// already-relative coords; this is here for spec hooks that work in
// page-space.
export function clientToCanvasPixel(clientX, clientY) {
  const vp = _vp();
  if (!vp || !vp.renderer) return null;
  const dom = vp.renderer.domElement;
  if (!dom) return null;
  const rect = dom.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

export const _supportedModes = ['xy', 'xz', 'yz', 'screen', 'surface'];
