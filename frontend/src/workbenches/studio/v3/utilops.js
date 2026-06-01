// ArchDisc Studio V3 — utility ops family.
//
//   __studioInstancedStress  — Unity/Unreal mass-instancing stress test
//   __studioFilletEdges      — Plasticity/Rhino crease-edge fillet via
//                              dihedral threshold + inward-shifted verts
//   __studioStreamAround     — Unreal World Partition cell streaming
//   __studioRevealAll        — un-stream every primitive
//   __studioBumpOutliner     — fire 'studio-outliner-bumped' so any UI
//                              outliner refreshes

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { streamAround as wpStreamAround, revealAll as wpRevealAll } from '../world/worldPartition.js';

function scene() {
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}
function activeMesh() {
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}
function findMeshByUuid(uuid) {
  if (!uuid) return null;
  const s = scene(); if (!s) return null;
  let m = null;
  s.traverse((o) => { if (o.isMesh && o.uuid === uuid) m = o; });
  return m;
}
function gatherStreamables() {
  const s = scene(); const a = [];
  s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) a.push(o); });
  return a;
}

function instancedStress(n) {
  const s = scene();
  const src = activeMesh();
  if (!s || !src || !src.geometry || !src.material) return { ok: false, error: 'no scene / source mesh' };
  const N = Math.max(1, n | 0);
  const inst = new THREE.InstancedMesh(src.geometry.clone(), src.material.clone(), N);
  const dummy = new THREE.Object3D();
  const cols = Math.ceil(Math.sqrt(N));
  const step = 0.04;
  const base = -(cols - 1) * step * 0.5;
  for (let i = 0; i < N; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    dummy.position.set(base + col * step, 0, base + row * step);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.userData.archdiscStudioPrimitive = true;
  inst.userData.archdiscStudioPrimitiveKind = 'instanced-stress';
  inst.userData.pickable = true;
  inst.name = `studio-primitive-instanced-${N}`;
  s.add(inst);
  window.__studioLastInstancedCount = N;
  return { ok: true, uuid: inst.uuid, count: N };
}

function filletEdges({ meshUuid, radius = 0.05, threshold = Math.PI / 6 } = {}) {
  const mesh = findMeshByUuid(meshUuid) || activeMesh();
  if (!mesh || !mesh.geometry) return { ok: false, error: 'no mesh' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  const cloned = mesh.geometry.clone();
  for (const k of ['normal', 'uv', 'uv1', 'uv2', 'tangent', 'color']) {
    if (cloned.attributes[k]) cloned.deleteAttribute(k);
  }
  const welded = mergeVertices(cloned, 1e-4);
  const pos = welded.attributes.position;
  const idx = welded.index ? welded.index.array : null;
  if (!idx) { cloned.dispose(); welded.dispose(); return { ok: false, error: 'no index after weld' }; }
  const triCount = idx.length / 3;
  const triN = new Float32Array(triCount * 3);
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    v0.fromBufferAttribute(pos, idx[t * 3]);
    v1.fromBufferAttribute(pos, idx[t * 3 + 1]);
    v2.fromBufferAttribute(pos, idx[t * 3 + 2]);
    e1.subVectors(v1, v0); e2.subVectors(v2, v0);
    n.crossVectors(e1, e2).normalize();
    triN[t * 3] = n.x; triN[t * 3 + 1] = n.y; triN[t * 3 + 2] = n.z;
  }
  const edgeMap = new Map();
  const vertTris = new Map();
  for (let t = 0; t < triCount; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = Math.min(u, v) + ',' + Math.max(u, v);
      const list = edgeMap.get(key); if (list) list.push(t); else edgeMap.set(key, [t]);
    }
    for (const i of [a, b, c]) {
      const list = vertTris.get(i); if (list) list.push(t); else vertTris.set(i, [t]);
    }
  }
  const sharpVerts = new Set();
  let sharpEdges = 0;
  for (const [key, faces] of edgeMap) {
    if (faces.length !== 2) continue;
    const tA = faces[0], tB = faces[1];
    const dot = triN[tA * 3] * triN[tB * 3] + triN[tA * 3 + 1] * triN[tB * 3 + 1] + triN[tA * 3 + 2] * triN[tB * 3 + 2];
    const dihedral = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (dihedral > threshold) {
      sharpEdges++;
      const [a, b] = key.split(',').map(Number);
      sharpVerts.add(a); sharpVerts.add(b);
    }
  }
  const inward = new THREE.Vector3();
  for (const i of sharpVerts) {
    const tris = vertTris.get(i) || [];
    inward.set(0, 0, 0);
    for (const t of tris) { inward.x -= triN[t * 3]; inward.y -= triN[t * 3 + 1]; inward.z -= triN[t * 3 + 2]; }
    if (inward.lengthSq() < 1e-10) continue;
    inward.normalize().multiplyScalar(radius);
    pos.setXYZ(i, pos.getX(i) + inward.x, pos.getY(i) + inward.y, pos.getZ(i) + inward.z);
  }
  pos.needsUpdate = true;
  welded.computeVertexNormals();
  welded.computeBoundingSphere();
  welded.computeBoundingBox();
  if (mesh.geometry && mesh.geometry.dispose) mesh.geometry.dispose();
  mesh.geometry = welded;
  cloned.dispose();
  mesh.userData.archdiscStudioFilleted = (mesh.userData.archdiscStudioFilleted || 0) + 1;
  return { ok: true, meshUuid: mesh.uuid, filletedEdges: sharpEdges, shiftedVerts: sharpVerts.size, radius, threshold };
}

function streamAround(origin, cellSize, radiusCells) {
  const r = wpStreamAround(gatherStreamables(), { origin: origin || [0, 0, 0], cellSize, radiusCells });
  return { ok: true, ...r };
}

function revealAll() {
  const r = wpRevealAll(gatherStreamables());
  return { ok: true, ...r };
}

function bumpOutliner() {
  window.dispatchEvent(new CustomEvent('studio-outliner-bumped', { detail: { ts: Date.now() } }));
  return { ok: true };
}

export function registerUtilOps() {
  window.__studioInstancedStress = instancedStress;
  window.__studioFilletEdges     = filletEdges;
  window.__studioStreamAround    = streamAround;
  window.__studioRevealAll       = revealAll;
  window.__studioBumpOutliner    = bumpOutliner;
}

export function unregisterUtilOps() {
  for (const k of [
    '__studioInstancedStress', '__studioFilletEdges',
    '__studioStreamAround', '__studioRevealAll', '__studioBumpOutliner',
  ]) { try { delete window[k]; } catch (_) {} }
}
