// ArchDisc Studio V3 — chromatic aberration ShaderPass (slice 924).
// REAL GLSL fragment shader offsetting R/G/B channels radially from screen
// center. Wired through slice 923 composer.

import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { registerOps } from '../common/registry.js';
let _installed = false;
const ChromAbShader = {
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: 0.005 },
    uCenter: { value: [0.5, 0.5] },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform vec2 uCenter;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - uCenter;
      float l = length(d);
      vec2 dir = l > 0.0 ? d / l : vec2(0.0);
      float r = texture2D(tDiffuse, vUv - dir * uIntensity * l).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv + dir * uIntensity * l).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};
let _pass = null;
export function installChromAbPass() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioChromAbPassEnable: ({ on = true, intensity = 0.005 } = {}) => {
      if (!_pass) _pass = new ShaderPass(ChromAbShader);
      _pass.uniforms.uIntensity.value = intensity;
      if (typeof window.__studioComposerRegister === 'function') {
        window.__studioComposerRegister({ name: 'chromAb', pass: _pass, order: 80, enabled: on });
      }
      return { ok: true, intensity };
    },
    __studioChromAbPassSetIntensity: ({ intensity = 0.005 } = {}) => {
      if (_pass) _pass.uniforms.uIntensity.value = intensity;
      return { ok: true };
    },
    __studioChromAbPassGetStats: () => ({ ok: true, intensity: _pass?.uniforms.uIntensity.value }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'Chromatic aberration ShaderPass');
  return { ok: true };
}
export default installChromAbPass;
