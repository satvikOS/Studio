// ArchDisc Studio V3 — real foliage wind vertex shader (slice 907).
// ShaderMaterial that displaces vertices in vertex shader per-leaf with
// trig + noise. No CPU per-vertex updates — GPU-resident animation.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
function _build({ baseColor = 0x2a8030, strength = 0.02, freq = 1.2 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:     { value: 0 },
      uStrength: { value: strength },
      uFreq:     { value: freq },
      uColor:    { value: new THREE.Color(baseColor) },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uStrength;
      uniform float uFreq;
      varying vec3 vNormal;
      void main() {
        vec3 p = position;
        float yFactor = max(0.0, p.y * 8.0);
        float n1 = sin(p.x * 4.0 + uTime * uFreq) * 0.5;
        float n2 = cos(p.z * 4.0 + uTime * uFreq * 1.3) * 0.5;
        p.x += n1 * uStrength * yFactor;
        p.z += n2 * uStrength * yFactor;
        vNormal = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying vec3 vNormal;
      void main() {
        float light = clamp(dot(normalize(vNormal), normalize(vec3(0.5, 1.0, 0.3))), 0.0, 1.0);
        gl_FragColor = vec4(uColor * (0.4 + 0.6 * light), 1.0);
      }
    `,
  });
}
const _materials = new Map();
let _hookInstalled = false;
function _hook() {
  if (_hookInstalled) return; _hookInstalled = true;
  const vp = window.__archdiscViewport; if (!vp) return;
  const prev = vp.__studioAnimTick;
  vp.__studioAnimTick = (now) => {
    prev?.(now);
    const t = now / 1000;
    for (const m of _materials.values()) m.uniforms.uTime.value = t;
  };
}
export function installWindShade() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioWindShadeApply: ({ meshUuid, baseColor, strength, freq } = {}) => {
      const scene = window.__archdiscScene; if (!scene) return { ok: false };
      const m = scene.getObjectByProperty('uuid', meshUuid); if (!m) return { ok: false };
      try { m.material?.dispose?.(); } catch (_) {}
      const mat = _build({ baseColor, strength, freq });
      m.material = mat;
      _materials.set(meshUuid, mat);
      _hook();
      return { ok: true };
    },
    __studioWindShadeRemove: ({ meshUuid } = {}) => { _materials.delete(meshUuid); return { ok: true }; },
    __studioWindShadeList: () => ({ ok: true, items: [..._materials.keys()] }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'fx', 'Foliage wind vertex shader');
  return { ok: true };
}
export default installWindShade;
