// ArchDisc Studio V3 — remesh family (DynaMesh, QuadRemesh, FieldQuadRemesh).
//
// ZBrush DynaMesh, uniform quad-dominant remesh, and Instant Meshes /
// ZRemesher-style curvature-aligned quad flow. All three reuse V2's
// helper modules under ../remesh/ so the kernel math is identical.

import * as THREE from 'three';
import { dynaMeshGeometry } from '../remesh/dynaMesh.js';
import { quadRemeshGeometry } from '../remesh/quadRemesh.js';
import { fieldAlignedQuadRemesh, FIELD_SURFACES } from '../remesh/fieldAlignedQuad.js';

const PRIMITIVE_SIZE = 0.03;

function scene() {
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}
function activeMesh() {
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
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

function dynaMesh(res) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry) return { ok: false, error: 'no mesh' };
  const geo = dynaMeshGeometry(mesh.geometry, { resolution: res || 26 });
  if (geo && geo.attributes.position && geo.attributes.position.count > 0) {
    if (mesh.geometry) mesh.geometry.dispose();
    mesh.geometry = geo;
    mesh.userData.archdiscStudioDynaMesh = geo.userData.archdiscDynaMesh;
    return { ok: true, vertices: geo.attributes.position.count, ...geo.userData.archdiscDynaMesh };
  }
  return { ok: false, error: 'dynamesh produced no geometry' };
}

function quadRemesh(res) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry) return { ok: false, error: 'no mesh' };
  const geo = quadRemeshGeometry(mesh.geometry, { resolution: res || 22 });
  if (geo && geo.attributes.position && geo.attributes.position.count > 0) {
    if (mesh.geometry) mesh.geometry.dispose();
    mesh.geometry = geo;
    mesh.userData.archdiscStudioQuadRemesh = geo.userData.archdiscQuadRemesh;
    mesh.userData.archdiscQuads = geo.userData.archdiscQuads;
    return { ok: true, vertices: geo.attributes.position.count, ...geo.userData.archdiscQuadRemesh };
  }
  return { ok: false, error: 'quad remesh produced no geometry' };
}

function fieldQuadRemesh(opts) {
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  const o = opts || {};
  const surfName = o.surface || 'diagwave';
  const S = FIELD_SURFACES[surfName] || FIELD_SURFACES.diagwave;
  const r = fieldAlignedQuadRemesh(S, o);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
  geo.setIndex(r.triIndex);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.15, roughness: 0.6, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'field-quad';
  mesh.userData.archdiscQuads = r.quads;
  mesh.userData.archdiscFieldQuad = {
    alignment: r.alignment, meanFieldAngle: r.meanFieldAngle,
    rows: r.rows, cols: r.cols, surface: surfName,
  };
  mesh.userData.pickable = true;
  const i = countPrims();
  mesh.name = `studio-primitive-fieldquad-${i}`;
  // Field-aligned quad wire overlay so the flow is legible.
  const segs = [];
  const pos = r.positions;
  for (const q of r.quads) {
    const e = [[q[0], q[1]], [q[1], q[2]], [q[2], q[3]], [q[3], q[0]]];
    for (const [x, y] of e) {
      segs.push(pos[x * 3], pos[x * 3 + 1], pos[x * 3 + 2], pos[y * 3], pos[y * 3 + 1], pos[y * 3 + 2]);
    }
  }
  const wgeo = new THREE.BufferGeometry();
  wgeo.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
  const wire = new THREE.LineSegments(wgeo, new THREE.LineBasicMaterial({ color: 0x161616 }));
  wire.userData.archdiscQuadWire = true;
  mesh.add(wire);
  const [x, y, z] = gridPos(i);
  mesh.position.set(x, y, z);
  s.add(mesh);
  if (window.__studioSelectMesh) { try { window.__studioSelectMesh(mesh); } catch (_) {} }
  return { ok: true, uuid: mesh.uuid, vertices: r.positions.length / 3, quadCount: r.quadCount, ...mesh.userData.archdiscFieldQuad };
}

export function registerRemeshOps() {
  window.__studioDynaMesh        = dynaMesh;
  window.__studioQuadRemesh      = quadRemesh;
  window.__studioFieldQuadRemesh = fieldQuadRemesh;
}

export function unregisterRemeshOps() {
  for (const k of [
    '__studioDynaMesh', '__studioQuadRemesh', '__studioFieldQuadRemesh',
  ]) { try { delete window[k]; } catch (_) {} }
}
