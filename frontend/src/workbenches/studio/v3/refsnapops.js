// ArchDisc Studio V3 — reference image + snap + BVH raycast family.
//
// V3-native ports of:
//   __studioAddRefPlane     — Blender background image / Maya image plane
//                             axis-aligned (front XY / side YZ / top XZ)
//   __studioSetReference    — pin a reference URL in the viewport top-left
//   __studioClearReference  — drop the pinned reference
//   __studioReferenceState  — current pinned reference + visibility
//   __studioFindSnapTarget  — nearest-vertex snap finder under a radius
//   __studioRaycastBVH      — BVH-accelerated scene raycast

import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

const PRIMITIVE_SIZE = 0.03;

// Patch THREE.Mesh once so V3's raycast uses BVH when boundsTree exists.
let __BVH_OK = false;
try {
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
  __BVH_OK = true;
} catch (_) { __BVH_OK = false; }

function scene() {
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}
function activeMesh() {
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}

const _bvhBuild = (mesh) => {
  if (!__BVH_OK || !mesh.geometry) return;
  const g = mesh.geometry;
  const stamp = g.attributes.position && g.attributes.position.version;
  if (g.boundsTree && g.userData.__bvhVersion === stamp) return;
  if (g.boundsTree && g.disposeBoundsTree) g.disposeBoundsTree();
  if (g.computeBoundsTree) g.computeBoundsTree();
  g.userData.__bvhVersion = stamp;
};

function raycastBVH(opts) {
  const { origin, direction, far = Infinity, filterUuid = null, firstHitOnly = true } = (opts || {});
  const s = scene();
  if (!s || !origin || !direction) return { ok: false, hit: false, error: 'bad args' };
  const meshes = [];
  s.traverse((o) => {
    if (!o.isMesh || !o.userData || !o.userData.archdiscStudioPrimitive) return;
    if (filterUuid && o.uuid === filterUuid) return;
    meshes.push(o);
  });
  meshes.forEach(_bvhBuild);
  const rc = new THREE.Raycaster(
    new THREE.Vector3(origin[0], origin[1], origin[2]),
    new THREE.Vector3(direction[0], direction[1], direction[2]).normalize(),
    0,
    far,
  );
  rc.firstHitOnly = !!firstHitOnly;
  const hits = rc.intersectObjects(meshes, false);
  if (!hits.length) return { ok: true, hit: false, point: null, meshUuid: null, distance: Infinity, faceIndex: -1, bvh: __BVH_OK };
  const h = hits[0];
  return {
    ok: true, hit: true,
    point: [h.point.x, h.point.y, h.point.z],
    meshUuid: h.object.uuid,
    distance: h.distance,
    faceIndex: h.faceIndex == null ? -1 : h.faceIndex,
    bvh: __BVH_OK,
  };
}

function findSnapTarget(opts) {
  const { fromPos, kinds = ['vertex'], radius = 0.5 } = (opts || {});
  const s = scene();
  if (!s || !fromPos) return { ok: false, error: 'no scene / fromPos' };
  if (!kinds.includes('vertex')) return { ok: false, error: 'only vertex snap kind supported' };
  const from = new THREE.Vector3(fromPos[0], fromPos[1], fromPos[2]);
  const sel = activeMesh();
  const selUuid = sel && sel.uuid;
  let best = null;
  const tmp = new THREE.Vector3();
  s.traverse((o) => {
    if (!o.isMesh || o.uuid === selUuid) return;
    const pos = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
    if (!pos) return;
    o.updateMatrixWorld();
    for (let i = 0; i < pos.count; i++) {
      tmp.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const d = tmp.distanceTo(from);
      if (d <= radius && (!best || d < best.distance)) {
        best = { kind: 'vertex', point: [tmp.x, tmp.y, tmp.z], distance: d, meshUuid: o.uuid, index: i };
      }
    }
  });
  if (!best) return { ok: false, error: 'no target within radius' };
  return { ok: true, ...best };
}

function addRefPlane(axis = 'front', imageUrl = null, opts = {}) {
  const s = scene();
  if (!s) return { ok: false, error: 'no scene' };
  const size = opts.size || PRIMITIVE_SIZE * 7;
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, map: null, transparent: true,
    opacity: opts.opacity != null ? opts.opacity : 0.5,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  if (axis === 'side') plane.rotation.y = Math.PI / 2;
  else if (axis === 'top') plane.rotation.x = -Math.PI / 2;
  const half = size / 2;
  if (axis === 'front') plane.position.set(opts.x || 0, opts.y != null ? opts.y : half * 0.85, opts.z != null ? opts.z : -half);
  else if (axis === 'side') plane.position.set(opts.x != null ? opts.x : -half, opts.y != null ? opts.y : half * 0.85, opts.z || 0);
  else plane.position.set(opts.x || 0, opts.y != null ? opts.y : 0, opts.z || 0);
  plane.renderOrder = -2;
  plane.userData.archdiscStudioRefPlane = true;
  plane.userData.archdiscStudioRefAxis = axis;
  plane.name = `studio-ref-${axis}`;
  s.add(plane);
  if (imageUrl) {
    new THREE.TextureLoader().load(imageUrl, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      if (tex.image && tex.image.width && tex.image.height) {
        const a = tex.image.width / tex.image.height;
        plane.scale.set(a >= 1 ? 1 : a, a >= 1 ? 1 / a : 1, 1);
      }
      mat.map = tex; mat.needsUpdate = true;
    });
  }
  return { ok: true, uuid: plane.uuid, axis, size };
}

// Reference URL pinned to a window-level slot (V3 doesn't have React
// state to mirror it; UI reads off the window slot).
function setReference(url, opts) {
  window.__studioReferenceUrl = url;
  window.__studioReferenceVisible = (opts && opts.visible !== undefined) ? !!opts.visible : true;
  window.dispatchEvent(new CustomEvent('studio-reference-changed', { detail: { url, visible: window.__studioReferenceVisible } }));
  return { ok: true, url, visible: window.__studioReferenceVisible };
}

function clearReference() {
  window.__studioReferenceUrl = null;
  window.__studioReferenceVisible = false;
  window.dispatchEvent(new CustomEvent('studio-reference-changed', { detail: { url: null, visible: false } }));
  return { ok: true, cleared: true };
}

function referenceState() {
  return {
    ok: true,
    url: window.__studioReferenceUrl || null,
    visible: !!window.__studioReferenceVisible,
  };
}

export function registerRefSnapOps() {
  window.__studioAddRefPlane    = addRefPlane;
  window.__studioSetReference   = setReference;
  window.__studioClearReference = clearReference;
  window.__studioReferenceState = referenceState;
  window.__studioFindSnapTarget = findSnapTarget;
  window.__studioRaycastBVH     = raycastBVH;
}

export function unregisterRefSnapOps() {
  for (const k of [
    '__studioAddRefPlane', '__studioSetReference', '__studioClearReference',
    '__studioReferenceState', '__studioFindSnapTarget', '__studioRaycastBVH',
  ]) { try { delete window[k]; } catch (_) {} }
}
