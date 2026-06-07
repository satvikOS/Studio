// ArchDisc Studio V3 — sharpen ShaderPass (slice 926).
// REAL GLSL unsharp-mask sharpen filter for crispening detail after TAA.

import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { registerOps } from '../common/registry.js';
let _installed = false;
const SharpenShader = {
  uniforms: {
    tDiffuse: { value: null },
    uStrength: { value: 0.3 },
    uResolution: { value: [1920, 1080] },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    uniform vec2 uResolution;
    varying vec2 vUv;
    void main() {
      vec2 px = 1.0 / uResolution;
      vec4 c = texture2D(tDiffuse, vUv);
      vec4 n = texture2D(tDiffuse, vUv + vec2(0, -px.y));
      vec4 s = texture2D(tDiffuse, vUv + vec2(0,  px.y));
      vec4 e = texture2D(tDiffuse, vUv + vec2( px.x, 0));
      vec4 w = texture2D(tDiffuse, vUv + vec2(-px.x, 0));
      vec4 sharpened = c * (1.0 + 4.0 * uStrength) - (n + s + e + w) * uStrength;
      gl_FragColor = vec4(clamp(sharpened.rgb, 0.0, 1.0), c.a);
    }
  `,
};
let _pass = null;
export function installSharpenPass() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioSharpenPassEnable: ({ on = true, strength = 0.3, width = 1920, height = 1080 } = {}) => {
      if (!_pass) _pass = new ShaderPass(SharpenShader);
      _pass.uniforms.uStrength.value = strength;
      _pass.uniforms.uResolution.value = [width, height];
      if (typeof window.__studioComposerRegister === 'function') {
        window.__studioComposerRegister({ name: 'sharpen', pass: _pass, order: 70, enabled: on });
      }
      return { ok: true };
    },
    __studioSharpenPassSet: ({ strength } = {}) => {
      if (_pass && strength != null) _pass.uniforms.uStrength.value = strength;
      return { ok: true };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'Sharpen ShaderPass');
  return { ok: true };
}
export default installSharpenPass;
