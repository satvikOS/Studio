// ArchDisc Studio V3 — EEVEE-style screen-space global illumination shader.
//
// One-pass SSGI. Per pixel, we sample a small Poisson-style kernel of
// nearby screen-space taps, weight each tap by (a) depth similarity and
// (b) normal alignment so we only gather indirect light from surfaces
// that plausibly share an albedo neighbourhood, then add a fraction of
// that gathered colour back into the base diffuse. The cheap approximation
// of one diffuse bounce that EEVEE relies on for its viewport preview.
//
// Inputs:
//   tDiffuse  — composer back buffer (the lit beauty pass before us)
//   tDepth    — linear-ish depth from a depth-only render of the scene
//   tNormal   — view-space normals from a MeshNormalMaterial render
//   uIntensity — 0..2 multiplier on the gathered indirect (default 1.0)
//   uRadius    — search radius in UV space (default 0.08)
//   uResolution — viewport size in pixels (sets the kernel scale)
//
// Output goes back to the composer's next pass via gl_FragColor.

export const SSGI_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SSGI_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform float uIntensity;
uniform float uRadius;
uniform vec2  uResolution;
uniform float uFrameSeed;

// Poisson-ish offsets in unit disc. 12 taps is a sweet spot between
// "noisy single tap" and "expensive 32-tap box blur". Symmetric pattern
// avoids directional bias that would tilt the gather toward one corner.
const int   SSGI_TAPS = 12;
const vec2  POISSON[12] = vec2[12](
  vec2( 0.150,  0.840), vec2(-0.620,  0.510), vec2( 0.770, -0.260),
  vec2(-0.310, -0.620), vec2( 0.580,  0.310), vec2(-0.090,  0.380),
  vec2( 0.420, -0.770), vec2(-0.910, -0.140), vec2( 0.240,  0.140),
  vec2(-0.330,  0.940), vec2( 0.960,  0.180), vec2(-0.720, -0.690)
);

// Cheap 1D hash for jittering the kernel orientation per pixel — kills
// the obvious circular kernel pattern and trades it for high-frequency
// noise that the composer can then optionally bloom or FXAA away.
float hash11(float x) {
  return fract(sin(x * 91.314159) * 47453.7193);
}

// Linearise depth coming out of the depth texture. The depth pass we
// chain in uses a basic non-linear z, so we sample directly: this is a
// rough heuristic, NOT a true reconstruction. Good enough for weighting.
float sampleDepth(vec2 uv) {
  return texture2D(tDepth, uv).r;
}

void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  float dCenter = sampleDepth(vUv);
  vec3  nCenter = normalize(texture2D(tNormal, vUv).xyz * 2.0 - 1.0);

  // Skip background / cleared depth: those pixels are the clear colour
  // or skybox; pulling them in produces blue / black halos around silhouettes.
  if (dCenter >= 0.9999) {
    gl_FragColor = base;
    return;
  }

  // Aspect-correct radius. uResolution is pixel size; divide so uRadius
  // in UV stays roughly equal in screen units at any aspect ratio.
  vec2 aspect = vec2(1.0, uResolution.x / max(1.0, uResolution.y));
  float jitter = hash11(vUv.x * 137.0 + vUv.y * 251.0 + uFrameSeed) * 6.28318;
  float cj = cos(jitter), sj = sin(jitter);
  mat2 rot = mat2(cj, -sj, sj, cj);

  vec3 acc = vec3(0.0);
  float wsum = 0.0;

  for (int i = 0; i < 12; i++) {
    vec2 off = rot * POISSON[i] * uRadius * aspect;
    vec2 sUv = vUv + off;
    if (sUv.x < 0.0 || sUv.x > 1.0 || sUv.y < 0.0 || sUv.y > 1.0) continue;

    float dS = sampleDepth(sUv);
    vec3  nS = normalize(texture2D(tNormal, sUv).xyz * 2.0 - 1.0);
    vec3  cS = texture2D(tDiffuse, sUv).rgb;

    // Depth-similarity weight: nearer-in-z gets more vote. Tuned so a
    // 0.005 z-difference (in NDC-ish 0..1) cuts the weight in half.
    float wDepth = exp(-abs(dS - dCenter) * 180.0);

    // Normal-similarity weight: dot product is 1 when aligned, 0 when
    // perpendicular. Cap to [0,1] so back-facing samples drop out.
    float wNormal = max(0.0, dot(nS, nCenter));

    // Distance falloff: outer ring contributes less than the inner.
    float wRadial = 1.0 - clamp(length(POISSON[i]), 0.0, 1.0);

    float w = wDepth * wNormal * wRadial;
    acc  += cS * w;
    wsum += w;
  }

  vec3 indirect = (wsum > 1e-5) ? (acc / wsum) : vec3(0.0);

  // The gather is a colour average of nearby lit pixels. Add a damped
  // fraction back as ambient bounce. Saturating prevents over-bright
  // hot spots where every tap agrees.
  vec3 lit = base.rgb + indirect * uIntensity * 0.35;
  lit = clamp(lit, 0.0, 4.0);

  gl_FragColor = vec4(lit, base.a);
}
`;

export default { SSGI_VERTEX, SSGI_FRAGMENT };
