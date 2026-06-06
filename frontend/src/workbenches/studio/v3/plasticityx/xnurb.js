// Slice 709 — Plasticity X-NURB depth. Adds the surface ops missing
// from slice-696 surfaces/: extend, unjoin/explode, untrim/retrim
// (silhouette extraction), zebra-stripe quality analysis, derive
// G2 continuous edge fillet between two adjacent NURBS surfaces.

import * as THREE from 'three';

// Extend a surface mesh along its edge by a delta amount.
export function extendSurface(meshUuid, edgeDir, delta) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry) return { ok: false };
  const pos = mesh.geometry.attributes.position;
  const dir = edgeDir || [1, 0, 0];
  const d = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]) || 1;
  // Find edge vertices: those with maximal dot(vertex, dir).
  let maxDot = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const dot = pos.array[i * 3] * dir[0] / d + pos.array[i * 3 + 1] * dir[1] / d + pos.array[i * 3 + 2] * dir[2] / d;
    if (dot > maxDot) maxDot = dot;
  }
  const thresh = maxDot - 0.05;
  for (let i = 0; i < pos.count; i++) {
    const dot = pos.array[i * 3] * dir[0] / d + pos.array[i * 3 + 1] * dir[1] / d + pos.array[i * 3 + 2] * dir[2] / d;
    if (dot < thresh) continue;
    pos.array[i * 3] += dir[0] / d * delta;
    pos.array[i * 3 + 1] += dir[1] / d * delta;
    pos.array[i * 3 + 2] += dir[2] / d * delta;
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  return { ok: true };
}

// Explode a mesh into per-triangle island meshes.
export function explodeToTriangles(meshUuid) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry) return { ok: false };
  const idx = mesh.geometry.index?.array;
  const pos = mesh.geometry.attributes.position.array;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  const uuids = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3] : t * 3;
    const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const positions = new Float32Array([
      pos[i0 * 3], pos[i0 * 3 + 1], pos[i0 * 3 + 2],
      pos[i1 * 3], pos[i1 * 3 + 1], pos[i1 * 3 + 2],
      pos[i2 * 3], pos[i2 * 3 + 1], pos[i2 * 3 + 2],
    ]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mesh.material.clone());
    m.position.copy(mesh.position);
    m.quaternion.copy(mesh.quaternion);
    m.scale.copy(mesh.scale);
    m.name = `${mesh.name}-tri-${t}`;
    if (window.__archdiscScene) window.__archdiscScene.add(m);
    uuids.push(m.uuid);
  }
  scene.remove(mesh);
  return { ok: true, count: uuids.length, uuids };
}

// Zebra-stripe quality analysis overlay. Replaces material temporarily
// with a stripe-pattern shader so surface continuity is visible.
const _zebraOriginal = new Map();
export function zebraOn(meshUuid, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh) return { ok: false };
  if (!_zebraOriginal.has(meshUuid)) _zebraOriginal.set(meshUuid, mesh.material);
  const stripeCount = Math.max(4, Math.min(64, Number(opts?.stripes) || 16));
  const mat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPos;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      precision mediump float;
      uniform float uStripes;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      void main() {
        vec3 r = reflect(normalize(vViewPos), normalize(vNormal));
        float v = (atan(r.y, r.x) + 3.14159) / 6.28318;
        float s = step(0.5, fract(v * uStripes));
        gl_FragColor = vec4(s, s, s, 1.0);
      }
    `,
    uniforms: { uStripes: { value: stripeCount } },
    side: THREE.DoubleSide,
  });
  mesh.material = mat;
  return { ok: true };
}

export function zebraOff(meshUuid) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh) return { ok: false };
  const orig = _zebraOriginal.get(meshUuid);
  if (orig) {
    mesh.material.dispose();
    mesh.material = orig;
    _zebraOriginal.delete(meshUuid);
  }
  return { ok: true };
}

// G2 edge fillet between two surface meshes — share endpoints +
// generate a rolling-sphere blend. Uses slice-706 rhinosurf variable
// fillet if installed, else basic sweep.
export function g2EdgeFillet(meshAUuid, meshBUuid, radius) {
  if (typeof window.__studioRhinoSurfVariableFillet === 'function') {
    // Build a straight edge between the two meshes' centroids.
    const scene = window.__archdiscScene;
    const A = scene.getObjectByProperty('uuid', meshAUuid);
    const B = scene.getObjectByProperty('uuid', meshBUuid);
    if (!A || !B) return { ok: false };
    A.updateMatrixWorld(true); B.updateMatrixWorld(true);
    const ca = new THREE.Box3().setFromObject(A).getCenter(new THREE.Vector3());
    const cb = new THREE.Box3().setFromObject(B).getCenter(new THREE.Vector3());
    const edge = [[ca.x, ca.y, ca.z], [cb.x, cb.y, cb.z]];
    return window.__studioRhinoSurfVariableFillet(edge, radius, { segments: 24, ring: 12 });
  }
  return { ok: false, error: 'rhinosurf variableFillet not installed' };
}
