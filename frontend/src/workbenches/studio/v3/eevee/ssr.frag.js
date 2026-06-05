// ArchDisc Studio V3 — EEVEE-style screen-space reflections shader.
//
// One-pass SSR. Per pixel, reconstruct an approximate view-space position
// + normal from the depth + normal buffers, reflect the view vector,
// march the reflected ray through screen space in fixed-size steps, and
// sample the diffuse texture at the first depth-buffer "hit" we find.
// Blend that colour into the base proportional to a screen-edge fade
// and the reflection strength.
//
// This is the cheap variant of SSR — no thickness check, no binary
// refinement after the linear march. Aim is EEVEE's preview-quality
// reflection, not a film-grade trace.
//
// Inputs:
//   tDiffuse    — composer back buffer (the lit beauty pass before us)
//   tDepth      — depth texture (non-linear z, same one SSGI consumes)
//   tNormal     — view-space normal RGB (MeshNormalMaterial output)
//   uMaxDist    — max trace distance in UV units (default 0.5)
//   uStep       — per-step march length in UV (default 0.02)
//   uSteps      — max iteration count (clamped 8..96, default 32)
//   uIntensity  — reflection mix factor (default 1.0)
//   uResolution — viewport pixels for aspect correction

export const SSR_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SSR_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform float uMaxDist;
uniform float uStep;
uniform float uIntensity;
uniform vec2  uResolution;
uniform float uFrameSeed;

const int   SSR_MAX_STEPS = 48;

// Compact per-pixel hash for jittering the start position by up to one
// step. Without this the ray marches snap to integer steps and produce
// a visible "stripe" artefact on shiny floors.
float hash11(float x) {
  return fract(sin(x * 12.9898) * 43758.5453);
}

void main() {
  vec4  base = texture2D(tDiffuse, vUv);
  float dCenter = texture2D(tDepth, vUv).r;

  // Skip background / sky: their normals are uninitialised noise and
  // reflecting them produces wild colour smears across silhouettes.
  if (dCenter >= 0.9999) {
    gl_FragColor = base;
    return;
  }

  vec3 nView = normalize(texture2D(tNormal, vUv).xyz * 2.0 - 1.0);

  // We do everything in 2D screen space — the reflected direction is
  // derived from the normal alone since the implicit view direction in
  // screen space is roughly +Z. dot(N,V) gives the reflection tilt.
  vec2 nXY = nView.xy;
  // Reflect the screen-space view vector (0,0,1) about the surface normal.
  // R = V - 2 * dot(N,V) * N -> only XY matter once we drop the Z component.
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 R = reflect(-V, nView);

  // Aspect-correct the step in UV so the trace covers equal screen distance
  // horizontally and vertically.
  vec2 aspect = vec2(1.0, uResolution.x / max(1.0, uResolution.y));
  vec2 dir = normalize(R.xy + vec2(1e-5)) * aspect;
  if (length(R.xy) < 0.0025) {
    // Reflection is essentially straight back at the camera — no march
    // would produce a usable hit. Output base and bail out.
    gl_FragColor = base;
    return;
  }

  float jitter = hash11(vUv.x * 311.7 + vUv.y * 71.3 + uFrameSeed);
  vec2  pos = vUv + dir * uStep * jitter;
  float traveled = 0.0;

  bool  hit = false;
  vec2  hitUv = vec2(0.0);
  float hitWeight = 0.0;

  for (int i = 0; i < SSR_MAX_STEPS; i++) {
    pos += dir * uStep;
    traveled += uStep;
    if (traveled > uMaxDist) break;
    if (pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) break;

    float dSample = texture2D(tDepth, pos).r;
    // Approximate "the reflected ray went behind a surface" with a
    // comparison: if the marched UV's z is now less than the depth-buffer
    // z at that pixel, we've crossed something. This is the cheap form
    // of SSR and works adequately for view-aligned reflectors (floors,
    // table tops). A real implementation would project a ray in view
    // space and compare reconstructed z; we trade fidelity for cost.
    if (dSample < dCenter - 0.0008) {
      hit = true;
      hitUv = pos;
      // Quadratic ramp on traveled distance: nearer hits weigh more,
      // distant hits fade so they don't slam saturated colour into a
      // grazing pixel.
      hitWeight = clamp(1.0 - (traveled / uMaxDist), 0.0, 1.0);
      hitWeight *= hitWeight;
      break;
    }
  }

  if (!hit) {
    gl_FragColor = base;
    return;
  }

  // Screen-edge fade: pixels reflecting toward the viewport border tend
  // to vanish; let them fade smoothly instead of popping.
  vec2  edgeDist = min(hitUv, vec2(1.0) - hitUv);
  float edgeFade = smoothstep(0.0, 0.06, min(edgeDist.x, edgeDist.y));
  hitWeight *= edgeFade;

  vec3  reflCol = texture2D(tDiffuse, hitUv).rgb;
  vec3  outCol = mix(base.rgb, base.rgb + reflCol * 0.6, hitWeight * uIntensity);
  outCol = clamp(outCol, 0.0, 4.0);

  gl_FragColor = vec4(outCol, base.a);
}
`;

export default { SSR_VERTEX, SSR_FRAGMENT };
