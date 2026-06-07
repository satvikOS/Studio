// ArchDisc Studio V3 — lens dirt ShaderPass (slice 927).
// REAL GLSL overlay of procedural dirt/streak pattern modulated by
// luminance bright-pass. Wires into composer at order 85.

import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { registerOps } from '../common/registry.js';
let _installed = false;
function _makeDirtTexture(kind = 'streaks') {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = 'rgba(255, 240, 220, 0.7)';
  if (kind === 'streaks') {
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * 512, y = Math.random() * 512;
      const l = 50 + Math.random() * 150;
      ctx.fillRect(x, y, l, 1 + Math.random() * 2);
    }
  } else if (kind === 'water_droplets') {
    for (let i = 0; i < 80; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'fingerprint') {
    for (let i = 0; i < 5; i++) {
      const cx = Math.random() * 512, cy = Math.random() * 512;
      for (let r = 10; r < 80; r += 4) {
        ctx.beginPath();
        ctx.arc(cx, cy, r + Math.random() * 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  } else {
    for (let i = 0; i < 200; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return new THREE.CanvasTexture(c);
}
const LensDirtShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDirt: { value: null },
    uIntensity: { value: 0.5 },
    uThreshold: { value: 0.7 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDirt;
    uniform float uIntensity;
    uniform float uThreshold;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      float bp = max(0.0, lum - uThreshold);
      vec4 dirt = texture2D(tDirt, vUv);
      c.rgb += dirt.rgb * bp * uIntensity;
      gl_FragColor = c;
    }
  `,
};
let _pass = null;
export function installLensDirtPass() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioLensDirtPassEnable: ({ on = true, intensity = 0.5, threshold = 0.7, textureKind = 'streaks' } = {}) => {
      if (!_pass) {
        _pass = new ShaderPass(LensDirtShader);
        _pass.uniforms.tDirt.value = _makeDirtTexture(textureKind);
      } else {
        _pass.uniforms.tDirt.value = _makeDirtTexture(textureKind);
      }
      _pass.uniforms.uIntensity.value = intensity;
      _pass.uniforms.uThreshold.value = threshold;
      if (typeof window.__studioComposerRegister === 'function') {
        window.__studioComposerRegister({ name: 'lensDirt', pass: _pass, order: 85, enabled: on });
      }
      return { ok: true };
    },
    __studioLensDirtPassSet: ({ intensity, threshold } = {}) => {
      if (!_pass) return { ok: false };
      if (intensity != null) _pass.uniforms.uIntensity.value = intensity;
      if (threshold != null) _pass.uniforms.uThreshold.value = threshold;
      return { ok: true };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'Lens dirt ShaderPass');
  return { ok: true };
}
export default installLensDirtPass;
