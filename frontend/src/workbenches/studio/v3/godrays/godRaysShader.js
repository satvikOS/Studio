// ArchDisc Studio V3 — screen-space god rays / volumetric light shafts.
//
// Real GLSL for the Mitchell 2007 (Crytek-style) radial-blur god-rays
// approach used by every modern engine that ships "volumetric light
// shafts" without doing a true 3D volume march. The lit scene already
// carries the brightness information we need; we don't need to ray-march
// participating media — we only need to smear the bright pixels radially
// from the projected sun position toward the camera.
//
// Algorithm (Mitchell, "Volumetric Light Scattering as a Post-Process",
// GPU Gems 3, ch. 13):
//
//   1. Project the world-space sun position into clip space and divide
//      to get the UV position of the sun on screen.
//   2. Build the vector from the current fragment UV → sun UV. That's
//      the radial direction; samples taken along it will smear toward
//      the sun.
//   3. March N samples along that vector. At each tap, read the scene
//      colour and multiply by an exponential decay weight so closer
//      samples to the current pixel contribute more. Apply a per-sample
//      decay so the smear stops cleanly at the sun and doesn't blow out
//      the whole frame.
//   4. The accumulator is multiplied by density × weight × exposure to
//      get the radial scattering contribution.
//   5. We output that contribution as an additive RGB pass; the host
//      composer is wired so the pass blends additively over the lit
//      scene (final = scene + godrays).
//
// We also accept a screen-space mask sampler — when the host provides an
// occlusion texture (a depth-pre-pass render of the scene where the sun
// disk is drawn in white and occluders are black), we sample that
// instead of tDiffuse so god rays only spawn from actually-visible sun
// pixels. When no mask is wired, the lit scene itself acts as the
// occluder (bright bloomed sun → strong rays; geometry covering the sun
// → no rays). This is the "minimal-dep" path the slice ships with.
//
// Uniforms:
//   tDiffuse     — back-buffer scene colour (read additively over).
//   tMask        — optional occluder/luminance texture (defaults to scene).
//   uSunUv       — UV of the projected sun position (off-screen ⇒ no rays).
//   uExposure    — global exposure on the rays (default 0.18).
//   uDecay       — per-sample decay (default 0.96 — Mitchell uses 0.96875).
//   uDensity     — overall ray density [0..2] (default 0.6).
//   uWeight      — per-sample weight (default 0.55).
//   uSamples     — march sample count (clamped 16..160, default 80).
//   uIntensity   — final multiplier (default 1.0).
//   uClampMax    — output clamp so we never punch through HDR (default 1.5).
//
// Both vertex and fragment are full-screen ShaderPass shaders following
// the same boilerplate the EEVEE SSGI/SSR passes use (vUv straight from
// the attribute, no view-space reconstruction needed).

export const GOD_RAYS_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const GOD_RAYS_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D tDiffuse;
uniform sampler2D tMask;
uniform vec2  uSunUv;
uniform float uExposure;
uniform float uDecay;
uniform float uDensity;
uniform float uWeight;
uniform float uIntensity;
uniform float uClampMax;
uniform int   uSamples;
uniform int   uUseMask;

// Mitchell 2007 calls this the "occlusion sample". Reads the luminance
// of the (optional) mask, or falls back to the scene's relative brightness
// when no mask is provided. The brightness fallback keeps the sun-side of
// the scene contributing rays without needing a dedicated render-to-RT
// for the sun disc — which would have required wiring a second scene
// render every frame.
float occluderSample(vec2 uv) {
  vec3 src;
  if (uUseMask == 1) {
    src = texture2D(tMask, uv).rgb;
  } else {
    src = texture2D(tDiffuse, uv).rgb;
  }
  // Rec. 709 luminance — same coefficients Mitchell uses for the
  // light-shaft scattering term in GPU Gems 3 §13.4.
  float lum = dot(src, vec3(0.2126, 0.7152, 0.0722));
  // Soft threshold so only the brighter-than-mid-grey pixels seed rays;
  // otherwise the entire scene smudges toward the sun. Knee = 0.55.
  float kneed = max(0.0, lum - 0.55) / max(1e-4, 1.0 - 0.55);
  return kneed;
}

void main() {
  // Always preserve the lit scene as the base — god rays composite on
  // top additively. ShaderPass writes our output directly to the next
  // composer buffer, so we *must* keep base.rgb in the result. The
  // "additive blend" the slice description calls for is therefore
  // base + scattered_rays here; the previous pass's beauty image stays
  // intact and we add the smear on top.
  vec4 base = texture2D(tDiffuse, vUv);

  // Off-screen sun ⇒ no rays this frame. We also kill the pass when the
  // projected sun is too far past the edge so the radial step doesn't
  // walk an enormous distance per tap and alias.
  vec2 sunUv = uSunUv;
  // Drop rays entirely once the sun's projection is more than half a
  // screen off-edge. Otherwise samples wrap and smear across the frame.
  if (sunUv.x < -0.5 || sunUv.x > 1.5 || sunUv.y < -0.5 || sunUv.y > 1.5) {
    gl_FragColor = base;
    return;
  }

  // Vector from THIS pixel back toward the sun on screen. Mitchell's
  // formulation has each pixel taking N samples *toward* the source.
  vec2 deltaUv = sunUv - vUv;
  // Sample-count parameter is dynamic (16..160). We still need a compile-
  // time loop bound for GLSL ES 1.0, so loop to the upper bound and break
  // when i >= uSamples. The compiler unrolls / early-exits cleanly.
  const int MAX_SAMPLES = 160;
  int sampleCount = uSamples;
  if (sampleCount < 16)  sampleCount = 16;
  if (sampleCount > 160) sampleCount = 160;

  float invSamples = 1.0 / float(sampleCount);
  // Density controls step length: bigger density ⇒ shorter steps ⇒
  // tighter, brighter rays near the sun. Mitchell's reference is 1.0.
  vec2 step = deltaUv * invSamples * uDensity;

  vec2 currentUv = vUv;
  float illumDecay = 1.0;
  vec3 accum = vec3(0.0);

  // Per-pixel jitter — kills banding from the regular march cadence.
  // Same hash trick the SSGI pass uses; the bands would otherwise show
  // up as concentric arcs around the sun, especially at low sample counts.
  float jitter = fract(sin(dot(vUv * 91.0, vec2(12.9898, 78.233))) * 43758.5453);
  currentUv += step * jitter;

  for (int i = 0; i < MAX_SAMPLES; i++) {
    if (i >= sampleCount) break;
    currentUv += step;
    // Stay inside the framebuffer.
    if (currentUv.x < 0.0 || currentUv.x > 1.0 ||
        currentUv.y < 0.0 || currentUv.y > 1.0) {
      illumDecay *= uDecay;
      continue;
    }
    // Mitchell sample colour: occluder (scene/mask) at this tap.
    float occ = occluderSample(currentUv);
    // Weight + decay per the GPU Gems formulation.
    occ *= uWeight * illumDecay;
    // Direct radial colour — light shafts inherit the sun colour. We
    // pick that as the *current* tap's scene colour so rays through
    // coloured volumetrics inherit the lit-pass colour, not a fixed white.
    vec3 sampleCol = texture2D(tDiffuse, currentUv).rgb;
    accum += sampleCol * occ;
    illumDecay *= uDecay;
  }

  vec3 rays = accum * uExposure * uIntensity;
  // Clamp to keep the additive composite from spiking when the user
  // bumps intensity and density together.
  rays = clamp(rays, 0.0, uClampMax);

  // Additive composite over the beauty pass.
  vec3 outRgb = base.rgb + rays;
  gl_FragColor = vec4(outRgb, base.a);
}
`;

// Build a fresh shader uniforms map for a ShaderPass. Caller passes the
// initial state; all defaults match the Mitchell reference values.
export function makeGodRaysUniforms(initial = {}) {
  return {
    tDiffuse:   { value: null },
    tMask:      { value: null },
    uSunUv:     { value: { x: 0.5, y: 0.7 } },     // overwritten per-frame
    uExposure:  { value: initial.exposure  != null ? initial.exposure  : 0.18 },
    uDecay:     { value: initial.decay     != null ? initial.decay     : 0.96 },
    uDensity:   { value: initial.density   != null ? initial.density   : 0.6 },
    uWeight:    { value: initial.weight    != null ? initial.weight    : 0.55 },
    uIntensity: { value: initial.intensity != null ? initial.intensity : 1.0 },
    uClampMax:  { value: initial.clampMax  != null ? initial.clampMax  : 1.5 },
    uSamples:   { value: initial.samples   != null ? Math.max(16, Math.min(160, initial.samples | 0)) : 80 },
    uUseMask:   { value: 0 },
  };
}

// Plain JS construction helper (so callers can build the shader spec
// without owning a THREE reference). Returns the {uniforms, vertexShader,
// fragmentShader} triple ShaderPass expects.
export function buildGodRaysShader(initial = {}) {
  return {
    uniforms: makeGodRaysUniforms(initial),
    vertexShader:   GOD_RAYS_VERTEX,
    fragmentShader: GOD_RAYS_FRAGMENT,
  };
}

export default { GOD_RAYS_VERTEX, GOD_RAYS_FRAGMENT, makeGodRaysUniforms, buildGodRaysShader };
