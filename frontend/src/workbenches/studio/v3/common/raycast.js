// ArchDisc Studio V3 — shared raycast helpers.
//
// Before dedup these primitives were re-implemented per-module:
//   - api.js   (__studioMathRayFromScreen / __studioMathClosestRayHit)
//   - editops.js (3× near-identical pickers — vertex / face / edge)
//   - rigui/dragger.js (handle pick)
//   - assetbrowser/AssetBrowserPanel.jsx (drag-drop target pick)
//
// Each call-site does the same four steps:
//   1. compute NDC from a pixel coordinate
//   2. raycaster.setFromCamera({ x, y }, camera)
//   3. raycaster.intersectObjects(meshes)
//   4. unpack the top hit (or null)
//
// This module collapses (1) + (2) + (3) into reusable helpers. Callers
// keep their own per-domain post-processing — there's no attempt to
// abstract face-pick vs vertex-pick semantics.

import * as THREE from 'three';

function _viewport() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscViewport || null;
}

function _scene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

// Convert a (pixelX, pixelY) coordinate on the renderer's canvas into
// NDC space [-1..1]. Used when the input is canvas-relative pixels.
// If no viewport, returns { ok: false }.
export function ndcFromPixel(pixelX, pixelY) {
  const v = _viewport();
  if (!v || !v.renderer) return { ok: false };
  const size = v.renderer.getSize(new THREE.Vector2());
  if (size.x <= 0 || size.y <= 0) return { ok: false };
  const x = (pixelX / size.x) * 2 - 1;
  const y = -((pixelY / size.y) * 2 - 1);
  return { ok: true, x, y };
}

// Returns the world-space ray for a viewport-relative pixel.
// Same shape as __studioMathRayFromScreen for backward compatibility.
export function rayFromScreen(pixelX, pixelY) {
  const v = _viewport();
  if (!v || !v.camera) return { ok: false };
  const nd = ndcFromPixel(pixelX, pixelY);
  if (!nd.ok) return { ok: false };
  const ray = new THREE.Raycaster();
  ray.setFromCamera({ x: nd.x, y: nd.y }, v.camera);
  return {
    ok: true,
    origin: [ray.ray.origin.x, ray.ray.origin.y, ray.ray.origin.z],
    direction: [ray.ray.direction.x, ray.ray.direction.y, ray.ray.direction.z],
  };
}

// Returns a *configured* THREE.Raycaster from a NDC-style {x, y}. Used
// by lower-level callers (handle pickers) that want to call
// intersectObjects themselves.
export function raycasterFromNDC(x, y) {
  const v = _viewport();
  if (!v || !v.camera) return null;
  const rc = new THREE.Raycaster();
  rc.setFromCamera({ x, y }, v.camera);
  return rc;
}

// Pick the closest hit against scene meshes, optionally filtered.
// filterFn: (o) => bool — false rejects the candidate. Pass null/undefined
// to use the default which excludes Studio gizmos / grid / ground.
export function closestHit(pixelX, pixelY, filterFn) {
  const v = _viewport();
  const scene = _scene();
  if (!v || !v.camera || !scene) return { ok: false };
  const nd = ndcFromPixel(pixelX, pixelY);
  if (!nd.ok) return { ok: false };
  const ray = new THREE.Raycaster();
  ray.setFromCamera({ x: nd.x, y: nd.y }, v.camera);
  const meshes = [];
  const accept = (typeof filterFn === 'function')
    ? filterFn
    : (o) => o.isMesh && !(o.userData && (o.userData.archdiscStudioGizmo || o.userData.archdiscStudioGrid || o.userData.archdiscStudioGround));
  scene.traverse((o) => { if (accept(o)) meshes.push(o); });
  if (!meshes.length) return { ok: true, hit: null };
  const hits = ray.intersectObjects(meshes, false);
  if (!hits.length) return { ok: true, hit: null };
  const h = hits[0];
  return {
    ok: true,
    hit: {
      uuid: h.object.uuid,
      point: [h.point.x, h.point.y, h.point.z],
      distance: h.distance,
      face: h.faceIndex,
      // Include the object reference for callers that want it; safe
      // because the result is consumed synchronously.
      object: h.object,
      uv: h.uv ? [h.uv.x, h.uv.y] : null,
    },
  };
}

// Pick the UV at the screen position (used by paint/foliage). Returns
// null if no hit or the underlying geometry has no UVs.
export function pickUVAt(pixelX, pixelY) {
  const r = closestHit(pixelX, pixelY);
  if (!r.ok || !r.hit) return null;
  return r.hit.uv;
}
