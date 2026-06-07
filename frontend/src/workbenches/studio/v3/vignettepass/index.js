// ArchDisc Studio V3 — vignette ShaderPass (slice 925).
// REAL GLSL radial darkening around screen edges.

import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { registerOps } from '../common/registry.js';
let _installed = false;
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: 0.3 },
    uSoftness: { value: 0.5 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform float uSoftness;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float r = length(d) * 1.414;
      float v = smoothstep(uSoftness, 1.0, r);
      c.rgb *= (1.0 - v * uIntensity);
      gl_FragColor = c;
    }
  `,
};
let _pass = null;
export function installVignettePass() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioVignettePassEnable: ({ on = true, intensity = 0.3, softness = 0.5 } = {}) => {
      if (!_pass) _pass = new ShaderPass(VignetteShader);
      _pass.uniforms.uIntensity.value = intensity;
      _pass.uniforms.uSoftness.value = softness;
      if (typeof window.__studioComposerRegister === 'function') {
        window.__studioComposerRegister({ name: 'vignette', pass: _pass, order: 90, enabled: on });
      }
      return { ok: true };
    },
    __studioVignettePassSet: ({ intensity, softness } = {}) => {
      if (_pass) {
        if (intensity != null) _pass.uniforms.uIntensity.value = intensity;
        if (softness != null) _pass.uniforms.uSoftness.value = softness;
      }
      return { ok: true };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'Vignette ShaderPass');
  return { ok: true };
}
export default installVignettePass;
