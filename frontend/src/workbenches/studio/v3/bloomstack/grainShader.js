// ArchDisc Studio V3 — film grain ShaderPass for slice 918 bloom + post stack.
//
// Real GLSL film grain implemented as a per-pixel deterministic hash that
// changes per-frame (uTime drives the seed). The grain modulates luma
// rather than RGB straight up so colours don't drift.
//
// Recipe is the classic "fract(sin(dot(...)) * large)" hash that ships in
// most shader-toy grain stacks — cheap and screen-space independent.
//
//   uIntensity — strength of the grain in [0,1]; 0 = clean
//   uTime      — wall-clock seconds; bumped from JS each frame
//   uResolution — pixel size, lets us scale grain so it doesn't get
//                 chunky on 4K canvases

const GRAIN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GRAIN_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uIntensity;
uniform float uTime;
uniform vec2  uResolution;
varying vec2 vUv;

// Cheap deterministic hash; per-pixel + seeded by time.
float _hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  // Pixel coords scaled so grain stays one-pixel-ish on 4K & 1080p both.
  vec2 px = vUv * uResolution;
  float n = _hash(px + vec2(uTime * 13.13, uTime * 7.7));
  // Map [0,1] hash to signed [-1,1] grain
  float grain = (n - 0.5) * 2.0;
  // Modulate luma; preserves colour fidelity better than raw RGB add
  float luma = dot(base.rgb, vec3(0.299, 0.587, 0.114));
  vec3 col = base.rgb + grain * uIntensity * (0.5 + 0.5 * luma);
  gl_FragColor = vec4(col, base.a);
}
`;

export const GrainShader = {
  uniforms: {
    tDiffuse:   { value: null },
    uIntensity: { value: 0.05 },
    uTime:      { value: 0.0 },
    uResolution:{ value: [1, 1] }, // [w,h] — replaced with Vector2 at construct time
  },
  vertexShader:   GRAIN_VERTEX,
  fragmentShader: GRAIN_FRAGMENT,
};

export default GrainShader;
