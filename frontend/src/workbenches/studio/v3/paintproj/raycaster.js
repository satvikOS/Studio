// ArchDisc Studio V3 — Mari-style projection painting raycaster.
//
// `pickAtScreen(x, y)` shoots a ray from the active viewport camera
// through the (clientX, clientY) pixel and returns the first scene mesh
// it hits along with the barycentric-interpolated UV at the hit point.
//
// Result shape (on hit):
//   { ok: true, mesh, uv: [u, v], faceIdx, worldPos: [x,y,z], distance }
//
// Notes:
//   - We use `intersectObjects` (plural) — three-mesh-bvh patches that
//     method only, and the BVH may be present from the sculpt / edit
//     pipelines (see Feedback — BVH raycast).
//   - Camera matrixWorldInverse is force-synced before every cast, since
//     the orbit controls only update it during render and we may be
//     mid-paint with no render-tick in between.
//   - The hit UV is interpolated from the geometry's `uv` attribute
//     using the same barycentric weights three's Mesh.raycast computes
//     against the face — that gives us a sub-pixel UV exactly matching
//     the cursor's 3D contact point.
//   - We exclude gizmos / grid / ground / IK handles + invisible meshes,
//     because painting onto a TransformControls handle would be bizarre.

import * as THREE from 'three';

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _tri = new THREE.Triangle();
const _bary = new THREE.Vector3();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _uvA = new THREE.Vector2();
const _uvB = new THREE.Vector2();
const _uvC = new THREE.Vector2();
const _uvOut = new THREE.Vector2();

function _getViewport() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscViewport || null;
}

function _isPaintable(o) {
  if (!o || !o.isMesh) return false;
  if (o.visible === false) return false;
  if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return false;
  const ud = o.userData;
  if (ud) {
    if (ud.archdiscStudioGizmo) return false;
    if (ud.archdiscStudioGrid) return false;
    if (ud.archdiscStudioGround) return false;
    if (ud.archdiscStudioIKHandle) return false;
    if (ud.archdiscStudioOutline) return false;
    if (ud.archdiscStudioAxesHelper) return false;
  }
  // Skip helpers (LineSegments are not meshes anyway).
  if (o.isTransformControlsPlane || o.isTransformControlsGizmo) return false;
  return true;
}

function _bvhBuildIfNeeded(geo) {
  if (geo && typeof geo.computeBoundsTree === 'function' && !geo.boundsTree) {
    try { geo.computeBoundsTree(); } catch (_) {}
  }
}

function _syncCamera(cam) {
  cam.updateMatrixWorld(true);
  if (cam.matrixWorldInverse) cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
}

// Compute (clientX, clientY) → NDC for the viewport's renderer canvas.
function _ndcFromClient(clientX, clientY, dom) {
  const r = dom.getBoundingClientRect();
  const w = r.width  > 0 ? r.width  : 1;
  const h = r.height > 0 ? r.height : 1;
  _ndc.x = ((clientX - r.left) / w) * 2 - 1;
  _ndc.y = -((clientY - r.top)  / h) * 2 + 1;
  return _ndc;
}

// Same as above but accepts NDC directly (-1..1).
function _setNdc(x, y) {
  _ndc.x = x; _ndc.y = y;
  return _ndc;
}

// Gather every paintable mesh under the scene root.
export function listPaintables(scene) {
  if (!scene) return [];
  const out = [];
  scene.traverse((o) => { if (_isPaintable(o)) out.push(o); });
  return out;
}

// Public — pick a (mesh, UV) pair from a screen-space pixel coord.
// `coords` may be either { client: [cx, cy] } or { ndc: [x, y] }; we
// also accept the bare-positional pair (x, y) interpreted as client.
export function pickAtScreen(x, y, opts) {
  const o = opts || {};
  const vp = _getViewport();
  if (!vp || !vp.camera || !vp.scene || !vp.renderer) {
    return { ok: false, error: 'no viewport' };
  }
  const dom = vp.renderer.domElement;
  if (o.ndc === true) _setNdc(Number(x), Number(y));
  else _ndcFromClient(Number(x), Number(y), dom);

  _syncCamera(vp.camera);
  _ray.setFromCamera(_ndc, vp.camera);
  _ray.firstHitOnly = true;

  // Filter scene meshes once. (We don't recurse — paintable meshes can
  // be nested in groups; intersectObjects with `recursive=true` walks.)
  const meshes = listPaintables(vp.scene);
  if (!meshes.length) return { ok: false, error: 'no meshes' };
  // Ensure each mesh has an up-to-date world matrix + (optionally) a
  // BVH for accelerated traversal — costly only on first use.
  for (const m of meshes) {
    m.updateMatrixWorld(true);
    _bvhBuildIfNeeded(m.geometry);
  }
  const hits = _ray.intersectObjects(meshes, false);
  if (!hits.length) return { ok: false, error: 'no hit' };
  const h = hits[0];

  // Barycentric-interpolated UV: prefer the hit.uv that three already
  // computed (Mesh.raycast fills it when the geometry has a `uv`
  // attribute), but fall back to a manual interpolation if missing.
  let u = 0, v = 0;
  if (h.uv && typeof h.uv.x === 'number') {
    u = h.uv.x; v = h.uv.y;
  } else if (h.object.geometry && h.object.geometry.attributes.uv) {
    const geo = h.object.geometry;
    const idx = geo.index ? geo.index.array : null;
    const f = h.faceIndex == null ? 0 : h.faceIndex;
    const a = idx ? idx[f * 3]     : f * 3;
    const b = idx ? idx[f * 3 + 1] : f * 3 + 1;
    const c = idx ? idx[f * 3 + 2] : f * 3 + 2;
    const pos = geo.attributes.position;
    const uvs = geo.attributes.uv;
    _vA.fromBufferAttribute(pos, a).applyMatrix4(h.object.matrixWorld);
    _vB.fromBufferAttribute(pos, b).applyMatrix4(h.object.matrixWorld);
    _vC.fromBufferAttribute(pos, c).applyMatrix4(h.object.matrixWorld);
    _tri.set(_vA, _vB, _vC);
    THREE.Triangle.getBarycoord(h.point, _vA, _vB, _vC, _bary);
    _uvA.fromBufferAttribute(uvs, a);
    _uvB.fromBufferAttribute(uvs, b);
    _uvC.fromBufferAttribute(uvs, c);
    _uvOut.set(0, 0)
      .addScaledVector(_uvA, _bary.x)
      .addScaledVector(_uvB, _bary.y)
      .addScaledVector(_uvC, _bary.z);
    u = _uvOut.x; v = _uvOut.y;
  }
  return {
    ok: true,
    mesh: h.object,
    meshUuid: h.object.uuid,
    uv: [u, v],
    faceIdx: h.faceIndex == null ? -1 : h.faceIndex,
    worldPos: [h.point.x, h.point.y, h.point.z],
    distance: h.distance,
  };
}

// Convenience — fire a ray straight from an NDC coordinate and return
// the raw THREE.Raycaster ray (used by projectImage.js to iterate an
// image's pixels in NDC space without rebuilding the ray each call).
export function rayFromNdc(ndcX, ndcY) {
  const vp = _getViewport();
  if (!vp || !vp.camera) return null;
  _syncCamera(vp.camera);
  _ray.setFromCamera(_setNdc(ndcX, ndcY), vp.camera);
  _ray.firstHitOnly = true;
  return _ray;
}

// Lazy helper used by projectImage: returns the same paintable list +
// world-matrix sync without re-traversing on every pixel.
export function gatherPaintables() {
  const vp = _getViewport();
  if (!vp || !vp.scene) return [];
  const meshes = listPaintables(vp.scene);
  for (const m of meshes) {
    m.updateMatrixWorld(true);
    _bvhBuildIfNeeded(m.geometry);
  }
  return meshes;
}

// Same UV interpolation logic as pickAtScreen but for an arbitrary hit
// object — used by projectImage so we don't duplicate the math.
export function uvAtHit(hit) {
  if (!hit || !hit.object) return null;
  if (hit.uv && typeof hit.uv.x === 'number') return [hit.uv.x, hit.uv.y];
  const obj = hit.object;
  const geo = obj.geometry;
  if (!geo || !geo.attributes.uv) return null;
  const idx = geo.index ? geo.index.array : null;
  const f = hit.faceIndex == null ? 0 : hit.faceIndex;
  const a = idx ? idx[f * 3]     : f * 3;
  const b = idx ? idx[f * 3 + 1] : f * 3 + 1;
  const c = idx ? idx[f * 3 + 2] : f * 3 + 2;
  const pos = geo.attributes.position;
  const uvs = geo.attributes.uv;
  _vA.fromBufferAttribute(pos, a).applyMatrix4(obj.matrixWorld);
  _vB.fromBufferAttribute(pos, b).applyMatrix4(obj.matrixWorld);
  _vC.fromBufferAttribute(pos, c).applyMatrix4(obj.matrixWorld);
  THREE.Triangle.getBarycoord(hit.point, _vA, _vB, _vC, _bary);
  _uvA.fromBufferAttribute(uvs, a);
  _uvB.fromBufferAttribute(uvs, b);
  _uvC.fromBufferAttribute(uvs, c);
  _uvOut.set(0, 0)
    .addScaledVector(_uvA, _bary.x)
    .addScaledVector(_uvB, _bary.y)
    .addScaledVector(_uvC, _bary.z);
  return [_uvOut.x, _uvOut.y];
}
