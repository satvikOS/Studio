// Slice 706 — Hair-shell fur. For each mesh, build N "shell" copies
// offset along the surface normal at exponentially decreasing
// thicknesses; sample a noise mask per fragment so only ~30 % of the
// shell is visible, simulating hair tips. Mirrors XGen / Yeti / Maya
// fur shells / Blender hair particles. Cheap, looks great on furry
// creatures.

import * as THREE from 'three';

const _fur = new Map();   // meshUuid → { shells: Mesh[], material: ShaderMaterial }

function _shellVert() {
  return `
    uniform float uOffset;
    varying vec2 vUv;
    varying float vShell;
    void main() {
      vUv = uv;
      vShell = uOffset;
      vec3 offsetPos = position + normal * uOffset;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(offsetPos, 1.0);
    }
  `;
}
function _shellFrag() {
  return `
    precision mediump float;
    uniform vec3 uColor;
    uniform float uDensity;
    uniform float uShellMax;
    varying vec2 vUv;
    varying float vShell;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec2 g = floor(vUv * uDensity);
      float h = hash(g);
      float t = vShell / uShellMax;
      // Strands appear in cells with h > 1 - density factor; the strand fades
      // as we travel up the shells.
      float strand = step(0.7, h);
      float alpha = strand * (1.0 - t * 0.9);
      if (alpha < 0.05) discard;
      vec3 c = uColor * (0.6 + 0.4 * (1.0 - t));
      gl_FragColor = vec4(c, alpha);
    }
  `;
}

export function applyFur(meshUuid, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const src = scene.getObjectByProperty('uuid', meshUuid);
  if (!src || !src.isMesh) return { ok: false };
  // Tear down existing fur if any.
  if (_fur.has(meshUuid)) clearFur(meshUuid);
  const shellCount = Math.max(4, Math.min(40, Number(opts?.shells) || 20));
  const length = Number(opts?.length) || 0.05;
  const density = Number(opts?.density) || 200;
  const color = opts?.color || [0.8, 0.65, 0.4];
  const colorV = new THREE.Color(color[0], color[1], color[2]);
  const shells = [];
  for (let i = 1; i <= shellCount; i++) {
    const offset = (i / shellCount) * length;
    const mat = new THREE.ShaderMaterial({
      vertexShader: _shellVert(),
      fragmentShader: _shellFrag(),
      uniforms: {
        uOffset: { value: offset },
        uColor: { value: colorV },
        uDensity: { value: density },
        uShellMax: { value: length },
      },
      transparent: true,
      depthWrite: false,
    });
    const sh = new THREE.Mesh(src.geometry, mat);
    sh.position.copy(src.position);
    sh.quaternion.copy(src.quaternion);
    sh.scale.copy(src.scale);
    sh.userData.archdiscFurShell = meshUuid;
    src.parent.add(sh);
    shells.push(sh);
  }
  _fur.set(meshUuid, { shells, density, length, color });
  return { ok: true, shells: shellCount };
}

export function clearFur(meshUuid) {
  const f = _fur.get(meshUuid);
  if (!f) return { ok: false };
  for (const sh of f.shells) {
    if (sh.parent) sh.parent.remove(sh);
    sh.material.dispose();
  }
  _fur.delete(meshUuid);
  return { ok: true };
}

export function setLength(meshUuid, length) {
  const f = _fur.get(meshUuid);
  if (!f) return { ok: false };
  f.length = Math.max(0, Number(length));
  for (let i = 0; i < f.shells.length; i++) {
    const offset = ((i + 1) / f.shells.length) * f.length;
    f.shells[i].material.uniforms.uOffset.value = offset;
    f.shells[i].material.uniforms.uShellMax.value = f.length;
  }
  return { ok: true };
}

export function setDensity(meshUuid, density) {
  const f = _fur.get(meshUuid);
  if (!f) return { ok: false };
  f.density = Math.max(1, Number(density));
  for (const sh of f.shells) sh.material.uniforms.uDensity.value = f.density;
  return { ok: true };
}

export function setColor(meshUuid, color) {
  const f = _fur.get(meshUuid);
  if (!f) return { ok: false };
  f.color = color;
  const c = new THREE.Color(color[0], color[1], color[2]);
  for (const sh of f.shells) sh.material.uniforms.uColor.value = c;
  return { ok: true };
}

export function listFur() {
  return {
    ok: true,
    fur: Array.from(_fur.entries()).map(([uuid, f]) => ({
      meshUuid: uuid, shells: f.shells.length, length: f.length, density: f.density,
    })),
  };
}
