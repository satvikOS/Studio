// ArchDisc Studio V3 — chromatic aberration ShaderPass for slice 918.
//
// Real GLSL RGB channel separation. The effect sweeps the R and B
// channels in opposite directions along the radial vector from screen
// centre, leaving G locked in place. The shift magnitude grows with the
// distance from centre so the centre stays crisp and the edges fringe —
// matches the lens-defect physics most "real lens" stacks (Unreal,
// Houdini Mantra, Blender Compositor) emulate.
//
//   uIntensity — strength of the channel split in UV units
//   uV         — UV from full-screen quad

const CHROMAB_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CHROMAB_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uIntensity;
varying vec2 vUv;

void main() {
  vec2 dir = vUv - 0.5;        // points from centre to current pixel
  // Falloff^2 keeps the centre clean and pushes the fringe out toward the
  // corners — same shape as real spherical aberration.
  float fall = dot(dir, dir);
  vec2 offset = dir * uIntensity * fall;
  float r = texture2D(tDiffuse, vUv + offset).r;
  float g = texture2D(tDiffuse, vUv).g;
  float b = texture2D(tDiffuse, vUv - offset).b;
  float a = texture2D(tDiffuse, vUv).a;
  gl_FragColor = vec4(r, g, b, a);
}
`;

export const ChromAbShader = {
  uniforms: {
    tDiffuse:   { value: null },
    uIntensity: { value: 0.005 },
  },
  vertexShader:   CHROMAB_VERTEX,
  fragmentShader: CHROMAB_FRAGMENT,
};

export default ChromAbShader;
