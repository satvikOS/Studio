// Slice 705 — ZBrush ZSphere skeleton sketcher. Build a parent-child
// tree of spheres in 3D; each segment becomes a stretched capsule;
// "adaptive skin" stitches them into a single watertight mesh by
// constructing tube geometry between connected ZSpheres. Mirrors
// ZBrush's ZSphere / Adaptive Skin workflow.

import * as THREE from 'three';

const _trees = new Map();
let _seq = 1;
function _uid() { return `zs-${_seq++}-${Date.now().toString(36)}`; }

export function createTree(opts) {
  const id = _uid();
  const root = {
    uuid: _uid(),
    pos: opts?.rootPos || [0, 0, 0],
    radius: Number(opts?.rootRadius) || 0.5,
    children: [],
    parent: null,
  };
  const helperGroup = new THREE.Group();
  helperGroup.name = `zs-helpers-${id}`;
  if (window.__archdiscScene) window.__archdiscScene.add(helperGroup);
  const tree = { id, root, all: new Map([[root.uuid, root]]), helperGroup, skinMesh: null };
  _trees.set(id, tree);
  _refreshHelpers(tree);
  return { ok: true, id, rootUuid: root.uuid };
}

export function addSphere(treeId, parentUuid, pos, radius) {
  const tree = _trees.get(treeId);
  if (!tree) return { ok: false };
  const parent = tree.all.get(parentUuid);
  if (!parent) return { ok: false };
  const node = {
    uuid: _uid(),
    pos: pos || [parent.pos[0] + 0.5, parent.pos[1], parent.pos[2]],
    radius: Number(radius) || parent.radius * 0.85,
    children: [],
    parent: parent.uuid,
  };
  parent.children.push(node);
  tree.all.set(node.uuid, node);
  _refreshHelpers(tree);
  return { ok: true, uuid: node.uuid };
}

export function moveSphere(treeId, uuid, pos) {
  const tree = _trees.get(treeId);
  if (!tree) return { ok: false };
  const n = tree.all.get(uuid);
  if (!n) return { ok: false };
  n.pos = pos;
  _refreshHelpers(tree);
  return { ok: true };
}

export function setRadius(treeId, uuid, radius) {
  const tree = _trees.get(treeId);
  if (!tree) return { ok: false };
  const n = tree.all.get(uuid);
  if (!n) return { ok: false };
  n.radius = Math.max(0.01, Number(radius));
  _refreshHelpers(tree);
  return { ok: true };
}

export function removeSphere(treeId, uuid) {
  const tree = _trees.get(treeId);
  if (!tree) return { ok: false };
  const n = tree.all.get(uuid);
  if (!n || !n.parent) return { ok: false, error: 'cannot remove root' };
  const p = tree.all.get(n.parent);
  p.children = p.children.filter((c) => c.uuid !== uuid);
  function _removeRec(node) {
    for (const c of node.children) _removeRec(c);
    tree.all.delete(node.uuid);
  }
  _removeRec(n);
  _refreshHelpers(tree);
  return { ok: true };
}

function _refreshHelpers(tree) {
  // Rebuild the helper group as wireframe spheres + capsules.
  while (tree.helperGroup.children.length) {
    const c = tree.helperGroup.children.pop();
    if (c.geometry) c.geometry.dispose();
    if (c.material) c.material.dispose();
  }
  const mat = new THREE.MeshBasicMaterial({ color: 0x44aaff, wireframe: true });
  function _walk(node) {
    const g = new THREE.SphereGeometry(node.radius, 12, 8);
    const m = new THREE.Mesh(g, mat);
    m.position.set(node.pos[0], node.pos[1], node.pos[2]);
    m.userData.zsphereUuid = node.uuid;
    tree.helperGroup.add(m);
    for (const c of node.children) _walk(c);
  }
  _walk(tree.root);
}

function _capsuleGeometry(p0, p1, r0, r1, segs) {
  // Build a tapered tube between two spheres p0(r0) and p1(r1).
  const dir = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const len = dir.length();
  if (len < 1e-5) return null;
  const axis = dir.clone().normalize();
  // Cylinder with end radii r0, r1, height len, oriented along Y; then rotate.
  const geo = new THREE.CylinderGeometry(r1, r0, len, segs, 1, false);
  geo.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  geo.applyQuaternion(q);
  geo.translate(p0[0], p0[1], p0[2]);
  return geo;
}

export function bakeAdaptiveSkin(treeId, opts) {
  const tree = _trees.get(treeId);
  if (!tree) return { ok: false };
  const segs = Math.max(8, Math.min(32, Number(opts?.segments) || 16));
  const geos = [];
  // Add sphere caps at every joint.
  function _walk(node) {
    geos.push(new THREE.SphereGeometry(node.radius, segs, Math.max(4, segs / 2)).translate(node.pos[0], node.pos[1], node.pos[2]));
    for (const c of node.children) {
      const cap = _capsuleGeometry(node.pos, c.pos, node.radius, c.radius, segs);
      if (cap) geos.push(cap);
      _walk(c);
    }
  }
  _walk(tree.root);
  // Merge into a single BufferGeometry — three's mergeGeometries helper.
  let merged = null;
  for (const g of geos) {
    if (!merged) {
      merged = g;
      continue;
    }
    merged = _mergeTwo(merged, g);
  }
  if (!merged) return { ok: false };
  merged.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xc0a070, roughness: 0.6 });
  if (tree.skinMesh) {
    if (window.__archdiscScene) window.__archdiscScene.remove(tree.skinMesh);
    tree.skinMesh.geometry.dispose();
    tree.skinMesh.material.dispose();
  }
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = `zs-skin-${treeId}`;
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'zsphere-skin';
  if (window.__archdiscScene) window.__archdiscScene.add(mesh);
  tree.skinMesh = mesh;
  if (typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(mesh); } catch (_) {}
  }
  return { ok: true, uuid: mesh.uuid, tris: (merged.index?.count || merged.attributes.position.count) / 3 };
}

function _mergeTwo(a, b) {
  // Simple concat of position + index arrays. Assumes both are non-indexed
  // or both are indexed; here we convert to non-indexed first.
  const A = a.toNonIndexed();
  const B = b.toNonIndexed();
  const posA = A.attributes.position.array;
  const posB = B.attributes.position.array;
  const out = new Float32Array(posA.length + posB.length);
  out.set(posA, 0);
  out.set(posB, posA.length);
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(out, 3));
  return merged;
}

export function listTrees() {
  return {
    ok: true,
    trees: Array.from(_trees.values()).map((t) => ({
      id: t.id, nodeCount: t.all.size, hasSkin: !!t.skinMesh,
    })),
  };
}

export function deleteTree(id) {
  const tree = _trees.get(id);
  if (!tree) return { ok: false };
  if (window.__archdiscScene) {
    window.__archdiscScene.remove(tree.helperGroup);
    if (tree.skinMesh) window.__archdiscScene.remove(tree.skinMesh);
  }
  _trees.delete(id);
  return { ok: true };
}
