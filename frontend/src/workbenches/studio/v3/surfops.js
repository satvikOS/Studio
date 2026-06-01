// ArchDisc Studio V3 — NURBS / B-Rep / hard-surface family.
//
// V3-native ports of the V2 hard-surface ops: Maya/Rhino NURBS curve and
// surface, 3ds Max Loft / Rhino Sweep1, Rhino trimmed surface, B-rep
// Boolean via OCCT WASM, and three-bvh-csg fillet. Each spawned mesh
// carries the same userData markers as V2 so outliner traversal, BVH
// raycast, undo snapshots, scene stats all keep working.

import * as THREE from 'three';
import { buildNurbsSurfaceGeometry } from '../nurbs/nurbsSurface.js';
import { buildNurbsCurveGeometry } from '../nurbs/nurbsCurve.js';
import { buildSweptGeometry } from '../surf/sweepLoft.js';
import { buildTrimmedSurface } from '../surf/trimmedSurface.js';

const PRIMITIVE_SIZE = 0.03;

function scene() {
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}
function countPrims() {
  const s = scene(); if (!s) return 0;
  let n = 0;
  s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
  return n;
}
function gridPos(i) {
  const cols = 4;
  return [
    (i % cols - (cols - 1) / 2) * PRIMITIVE_SIZE * 1.9,
    0,
    Math.floor(i / cols) * PRIMITIVE_SIZE * 1.9,
  ];
}
function attachAndSelect(mesh) {
  const s = scene(); if (!s) return;
  s.add(mesh);
  if (window.__studioSelectMesh) { try { window.__studioSelectMesh(mesh); } catch (_) {} }
}

function addNurbsSurface(opts) {
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  const geometry = buildNurbsSurfaceGeometry(opts || {});
  const material = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.15, roughness: 0.55, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'nurbs-surface';
  mesh.userData.archdiscNurbs = geometry.userData.archdiscNurbs;
  mesh.userData.pickable = true;
  const i = countPrims();
  mesh.name = `studio-primitive-nurbs-${i}`;
  const [x, y, z] = gridPos(i);
  mesh.position.set(x, y, z);
  attachAndSelect(mesh);
  return { ok: true, uuid: mesh.uuid, vertices: geometry.attributes.position.count, nurbs: geometry.userData.archdiscNurbs };
}

function sweepLoft(opts) {
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  const geometry = buildSweptGeometry(opts || {});
  if (!geometry) return { ok: false, error: 'sweep produced no geometry' };
  const material = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.2, roughness: 0.5, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'sweep-loft';
  mesh.userData.archdiscSweep = geometry.userData.archdiscSweep;
  mesh.userData.pickable = true;
  const i = countPrims();
  mesh.name = `studio-primitive-sweep-${i}`;
  const [x, y, z] = gridPos(i);
  mesh.position.set(x, y, z);
  attachAndSelect(mesh);
  return { ok: true, uuid: mesh.uuid, vertices: geometry.attributes.position.count, ...geometry.userData.archdiscSweep };
}

function addNurbsCurve(opts) {
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  const geometry = buildNurbsCurveGeometry(opts || {});
  const material = new THREE.MeshStandardMaterial({ color: 0x9098a3, metalness: 0.3, roughness: 0.4 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'nurbs-curve';
  mesh.userData.archdiscNurbsCurve = geometry.userData.archdiscNurbsCurve;
  mesh.userData.pickable = true;
  const i = countPrims();
  mesh.name = `studio-primitive-nurbscurve-${i}`;
  const [x, y, z] = gridPos(i);
  mesh.position.set(x, y, z);
  attachAndSelect(mesh);
  return { ok: true, uuid: mesh.uuid, vertices: geometry.attributes.position.count, ...geometry.userData.archdiscNurbsCurve };
}

function addTrimmedSurface(opts) {
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  const geometry = buildTrimmedSurface(opts || {});
  const material = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.18, roughness: 0.55, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'trimmed-surface';
  mesh.userData.archdiscTrim = geometry.userData.archdiscTrim;
  mesh.userData.pickable = true;
  const i = countPrims();
  mesh.name = `studio-primitive-trimmed-${i}`;
  const [x, y, z] = gridPos(i);
  mesh.position.set(x, y, z);
  attachAndSelect(mesh);
  return { ok: true, uuid: mesh.uuid, vertices: geometry.attributes.position.count, ...geometry.userData.archdiscTrim };
}

// Lazy OCCT — kernel is large; only loaded the first time the user
// actually fires a Boolean.
async function brepBoolean(opts) {
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  try {
    const { occtBoolean } = await import('../brep/occtBoolean.js');
    const r = await occtBoolean(opts || {});
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(r.indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.2, roughness: 0.5, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'brep-boolean';
    mesh.userData.archdiscBRep = { faces: r.faces, verts: r.verts, tris: r.tris, op: r.op };
    mesh.userData.pickable = true;
    const i = countPrims();
    mesh.name = `studio-primitive-brep-${i}`;
    const [x, y, z] = gridPos(i);
    mesh.position.set(x, y, z);
    attachAndSelect(mesh);
    return { ok: true, uuid: mesh.uuid, ...r };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

export function registerSurfOps() {
  window.__studioAddNurbsSurface = addNurbsSurface;
  window.__studioAddNurbsCurve   = addNurbsCurve;
  window.__studioSweepLoft       = sweepLoft;
  window.__studioTrimmedSurface  = addTrimmedSurface;
  window.__studioBRepBoolean     = brepBoolean;
}

export function unregisterSurfOps() {
  for (const k of [
    '__studioAddNurbsSurface', '__studioAddNurbsCurve', '__studioSweepLoft',
    '__studioTrimmedSurface', '__studioBRepBoolean',
  ]) { try { delete window[k]; } catch (_) {} }
}
