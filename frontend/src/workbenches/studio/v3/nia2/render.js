// ArchDisc Studio V3 — Niagara-style emitter render layer (slice 764).
//
// `buildParticleMesh(emitter)` builds a `THREE.InstancedMesh` of a small
// quad geometry — one instance per slot in the emitter's pool.
// Billboard alignment is done in the vertex shader: the per-vertex
// position from the unit quad is rebuilt in view space using the
// camera-relative right + up vectors so the quad always faces the
// camera. The InstancedMesh's `instanceMatrix` carries the per-particle
// world-space translation; `instanceColor` carries the per-particle
// RGB so the colour-over-life curve shows up in the shader.
//
// Dead slots get `scale = 0` so they collapse to a point and are
// effectively invisible without paying for a separate "live" buffer.
//
// `updateParticleMesh(mesh, emitter)` writes the emitter's current
// position + size + colour arrays into the InstancedMesh's instance
// matrix + colour buffers, marking the relevant attributes dirty. This
// is called from the simulation tick AFTER `Emitter.update(dt)` lands
// the new state.

import * as THREE from 'three';

const _quadGeo = (() => {
  const geo = new THREE.PlaneGeometry(1, 1);
  return geo;
})();

// Vertex shader: read the base quad position from `position`, recompose
// it in view space using camera right/up so the quad faces the camera.
// The instance matrix only carries translation + scale (no rotation),
// so the billboard is camera-aligned regardless of the emitter origin.
const VERT = /* glsl */`
attribute vec3 instanceColor;
varying vec3 vColor;
varying vec2 vUv;
void main() {
  vColor = instanceColor;
  vUv = uv;
  // Translation + scale come from the instance matrix. We need the
  // world-space centre + the per-instance scale separately so the
  // billboard is built in view space.
  vec3 worldCentre = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  // Pull the diagonal scale out of the instance matrix (no rotation by
  // construction so this is just the x/y magnitude of the first column).
  float sx = length(vec3(instanceMatrix[0]));
  float sy = length(vec3(instanceMatrix[1]));
  // Camera-space billboard: use the view matrix' right + up rows.
  vec4 mvCentre = viewMatrix * vec4(worldCentre, 1.0);
  vec3 mvPos = mvCentre.xyz
    + vec3(position.x * sx, position.y * sy, 0.0);
  gl_Position = projectionMatrix * vec4(mvPos, 1.0);
}
`;

const FRAG = /* glsl */`
precision mediump float;
varying vec3 vColor;
varying vec2 vUv;
void main() {
  // Soft round falloff so the quad reads as a circular puff.
  vec2 c = vUv - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  float a = smoothstep(0.25, 0.0, d);
  gl_FragColor = vec4(vColor, a);
}
`;

function _buildMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// Build a fresh InstancedMesh sized to the emitter's pool. The mesh
// owns its own material + geometry refcount; `disposeParticleMesh`
// frees them when the emitter is torn down.
export function buildParticleMesh(emitter) {
  if (!emitter || typeof emitter.count !== 'number') {
    throw new Error('buildParticleMesh: emitter is required');
  }
  const geo = _quadGeo.clone();
  const mat = _buildMaterial();
  const mesh = new THREE.InstancedMesh(geo, mat, emitter.count);
  mesh.frustumCulled = false;
  mesh.name = 'nia2-particles';
  mesh.userData.archdiscStudioNia2 = true;
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'nia2-emitter';
  // Per-instance colour attribute.
  const colorAttr = new THREE.InstancedBufferAttribute(
    new Float32Array(emitter.count * 3), 3
  );
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('instanceColor', colorAttr);
  mesh.userData.archdiscStudioNia2ColorAttr = colorAttr;
  // Seed instanceMatrix to zero-scale so dead slots are invisible on
  // first render before the first `updateParticleMesh` lands.
  const m = new THREE.Matrix4();
  m.makeScale(0, 0, 0);
  for (let i = 0; i < emitter.count; i++) mesh.setMatrixAt(i, m);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// Write the emitter's current position + size + colour arrays into the
// mesh's per-instance buffers. Dead slots get `scale = 0` so they
// don't render (the fragment shader's discard would also catch them
// since size 0 collapses uv span, but zero-scale is the cleaner gate).
const _scratch = new THREE.Matrix4();
export function updateParticleMesh(mesh, emitter) {
  if (!mesh || !emitter) return;
  if (mesh.count !== emitter.count) return; // pool size changed under us
  const colorAttr = mesh.userData.archdiscStudioNia2ColorAttr;
  const colorArr = colorAttr ? colorAttr.array : null;
  const cap = emitter.count;
  for (let i = 0; i < cap; i++) {
    if (emitter.alive[i]) {
      const s = emitter.sizes[i];
      _scratch.makeScale(s, s, s);
      _scratch.elements[12] = emitter.positions[i * 3];
      _scratch.elements[13] = emitter.positions[i * 3 + 1];
      _scratch.elements[14] = emitter.positions[i * 3 + 2];
      mesh.setMatrixAt(i, _scratch);
      if (colorArr) {
        colorArr[i * 3]     = emitter.colors[i * 3];
        colorArr[i * 3 + 1] = emitter.colors[i * 3 + 1];
        colorArr[i * 3 + 2] = emitter.colors[i * 3 + 2];
      }
    } else {
      _scratch.makeScale(0, 0, 0);
      mesh.setMatrixAt(i, _scratch);
      if (colorArr) {
        colorArr[i * 3]     = 0;
        colorArr[i * 3 + 1] = 0;
        colorArr[i * 3 + 2] = 0;
      }
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (colorAttr) colorAttr.needsUpdate = true;
}

// Tear down a particle mesh — detach from parent, dispose GPU
// resources. Safe to call even if the mesh was never parented.
export function disposeParticleMesh(mesh) {
  if (!mesh) return;
  try { if (mesh.parent) mesh.parent.remove(mesh); } catch (_) { /* swallow */ }
  try { if (mesh.geometry && mesh.geometry.dispose) mesh.geometry.dispose(); } catch (_) {}
  try { if (mesh.material && mesh.material.dispose) mesh.material.dispose(); } catch (_) {}
}
