// ArchDisc Studio V3 — vignette ShaderPass for slice 918 bloom + post stack.
//
// Real GLSL radial darkening around the screen edges. The shader runs
// after UnrealBloomPass so the bloom highlights are visible inside the
// vignette mask rather than being squashed back to grey.
//
// Implementation: classic "smoothstep on distance from centre" recipe.
// Coordinates are normalised to a square (aspect-corrected) so the
// vignette stays circular on widescreen viewports rather than oval.
//
//   uV       — UV in [0,1] from the full-screen quad
//   uIntensity — 0 = no vignette, 1 = corners go black
//   uRadius  — inner radius where the falloff starts (0..1)
//   uSoftness — width of the smoothstep transition
//   uAspect  — viewport.x / viewport.y to keep the falloff circular

const VIGNETTE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const VIGNETTE_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uIntensity;
uniform float uRadius;
uniform float uSoftness;
uniform float uAspect;
varying vec2 vUv;

void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  // Aspect-correct so a 16:9 screen still has a circular vignette.
  vec2 centred = vUv - 0.5;
  centred.x *= max(uAspect, 1.0);
  centred.y *= max(1.0 / max(uAspect, 0.0001), 1.0);
  float dist = length(centred);
  // smoothstep starts dark at edges and fades to clear at the inner radius
  float falloff = smoothstep(uRadius, uRadius + uSoftness, dist);
  float mask = 1.0 - uIntensity * falloff;
  gl_FragColor = vec4(base.rgb * mask, base.a);
}
`;

export const VignetteShader = {
  uniforms: {
    tDiffuse:   { value: null },
    uIntensity: { value: 0.3 },
    uRadius:    { value: 0.55 },
    uSoftness:  { value: 0.45 },
    uAspect:    { value: 1.0 },
  },
  vertexShader:   VIGNETTE_VERTEX,
  fragmentShader: VIGNETTE_FRAGMENT,
};

export default VignetteShader;
