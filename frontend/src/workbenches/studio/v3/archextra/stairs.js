// Slice 701 — Architectural prefabs: stairs, railings, terrain, sections.

import * as THREE from 'three';

function _box(w, h, d, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.MeshStandardMaterial({ color: color || 0xc0a070, roughness: 0.7 });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  return mesh;
}

export function createStairs(opts) {
  const steps = Math.max(2, Math.min(40, Math.floor(opts?.steps) || 12));
  const stepWidth = Number(opts?.width) || 1.5;
  const stepDepth = Number(opts?.depth) || 0.3;
  const stepHeight = Number(opts?.height) || 0.18;
  const group = new THREE.Group();
  for (let i = 0; i < steps; i++) {
    const tread = _box(stepWidth, stepHeight, stepDepth, 0, i * stepHeight + stepHeight / 2, i * stepDepth + stepDepth / 2, 0xb0926a);
    group.add(tread);
  }
  group.name = 'stairs';
  group.userData.archdiscStudioPrimitive = true;
  group.userData.archdiscStudioPrimitiveKind = 'arch-stairs';
  return group;
}

export function createRailing(p1, p2, opts) {
  const height = Number(opts?.height) || 1.0;
  const postSpacing = Number(opts?.postSpacing) || 0.5;
  const postR = Number(opts?.postR) || 0.025;
  const a = new THREE.Vector3(...(p1 || [0, 0, 0]));
  const b = new THREE.Vector3(...(p2 || [2, 0, 0]));
  const len = a.distanceTo(b);
  if (len < 0.01) return null;
  const dir = b.clone().sub(a).normalize();
  const postCount = Math.max(2, Math.floor(len / postSpacing) + 1);
  const group = new THREE.Group();
  // Posts.
  for (let i = 0; i < postCount; i++) {
    const t = i / (postCount - 1);
    const pos = a.clone().lerp(b, t);
    const g = new THREE.CylinderGeometry(postR, postR, height, 8);
    const m = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.4, roughness: 0.5 });
    const post = new THREE.Mesh(g, m);
    post.position.copy(pos);
    post.position.y += height / 2;
    group.add(post);
  }
  // Top rail.
  const topG = new THREE.CylinderGeometry(postR * 1.5, postR * 1.5, len, 8);
  const topM = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.4, roughness: 0.5 });
  const top = new THREE.Mesh(topG, topM);
  top.position.copy(a.clone().lerp(b, 0.5));
  top.position.y += height;
  top.lookAt(b.x, top.position.y, b.z);
  top.rotateX(Math.PI / 2);
  group.add(top);
  group.name = 'railing';
  group.userData.archdiscStudioPrimitive = true;
  group.userData.archdiscStudioPrimitiveKind = 'arch-railing';
  return group;
}

export function createTerrain(opts) {
  const w = Number(opts?.width) || 30;
  const d = Number(opts?.depth) || 30;
  const segs = Math.max(8, Math.min(128, Math.floor(opts?.segments) || 48));
  const amplitude = Number(opts?.amplitude) || 1.5;
  const frequency = Number(opts?.frequency) || 0.1;
  const geo = new THREE.PlaneGeometry(w, d, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.array[i * 3];
    const z = pos.array[i * 3 + 2];
    const h = Math.sin(x * frequency) * Math.cos(z * frequency) * amplitude * 0.5
            + Math.sin(x * frequency * 2.3) * Math.cos(z * frequency * 1.7) * amplitude * 0.3
            + (Math.random() - 0.5) * amplitude * 0.05;
    pos.array[i * 3 + 1] = h;
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8aa089, roughness: 0.9, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'arch-terrain';
  return mesh;
}

export function createSection(meshUuid, planeNormal, planeOffset) {
  // Build a clipping-plane section view: clones the mesh + applies a
  // ClippingPlane via material.clippingPlanes. Returns the clone.
  const scene = window.__archdiscScene;
  if (!scene) return null;
  const src = scene.getObjectByProperty('uuid', meshUuid);
  if (!src || !src.geometry) return null;
  const n = Array.isArray(planeNormal) ? planeNormal : [0, 1, 0];
  const o = Number(planeOffset) || 0;
  const plane = new THREE.Plane(new THREE.Vector3(n[0], n[1], n[2]).normalize(), -o);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xc4d4e6, roughness: 0.5, metalness: 0.2,
    side: THREE.DoubleSide,
    clippingPlanes: [plane], clipIntersection: false,
  });
  const mesh = new THREE.Mesh(src.geometry.clone(), mat);
  mesh.position.copy(src.position);
  mesh.quaternion.copy(src.quaternion);
  mesh.scale.copy(src.scale);
  mesh.name = 'section';
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'arch-section';
  // Enable local clipping globally on the renderer.
  if (window.__archdiscViewport?.renderer) {
    window.__archdiscViewport.renderer.localClippingEnabled = true;
  }
  return mesh;
}
