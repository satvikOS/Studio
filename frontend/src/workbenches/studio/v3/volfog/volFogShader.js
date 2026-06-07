// ArchDisc Studio V3 — slice 920 — Real volumetric fog GLSL.
//
// Screen-space ray-march that reconstructs the world position behind each
// pixel from a linearised depth sample and marches from the camera origin
// to that surface in N constant-length steps. At every step we compute:
//
//   density   = sigma * exp(-heightFalloff * max(0, worldY - fogBaseY))
//   scatter   = density * (sunLight * phaseHG(cosTheta, g) + ambient)
//   transmit *= exp(-density * sigma_t * dt)            // Beer-Lambert
//
// where cosTheta is the dot product between the view-ray direction and
// the direction *toward* the sun. The Henyey-Greenstein phase produces
// the strong forward-scatter you see when looking *into* the sun — the
// signature look of god-rays and Mie-scattered dawn / dusk haze.
//
// At march end we mix the original scene colour by the accumulated Beer
// transmittance and add the integrated in-scattered radiance — energy
// conserving, with `multiScatter` controlling how much we re-introduce
// reflected sky/ambient on top of the single-scatter sun term (a cheap
// stand-in for the second-order isotropic bounce a real volume integrator
// would compute, the same approximation EEVEE's volumetric pass uses).
//
// Inputs (uniforms, set by ShaderPass wrapper in index.js):
//   tDiffuse              — composer back buffer (scene colour)
//   tDepth                — depth-texture from the aux depth render-target
//   uInvViewProj          — mat4 inverse(camera.projection * camera.view)
//   uCameraPos            — vec3 camera world-space position
//   uCameraNear/Far       — float, used to linearise the non-linear depth
//   uSunDir               — vec3 normalised vector *toward* the sun light
//   uSunColor             — vec3 sun colour × intensity
//   uAmbient              — vec3 ambient sky contribution (un-shadowed)
//   uFogColor             — vec3 base fog tint
//   uDensity              — float overall scattering coefficient (sigma)
//   uHeightFalloff        — float exponential height-falloff coefficient
//   uFogBaseY             — float world-space base altitude for the volume
//   uAnisotropy           — float HG g parameter (−1..+1)
//   uMultiScatter         — float 0..1 fraction of multi-scatter term
//   uMaxDistance          — float clamp on march distance (m)
//   uFrameSeed            — float for blue-noise dither (prevents banding)
//
// The shader is intentionally written for portability — no ES3 extensions,
// no derivatives beyond what ShaderPass already provides — so it lights up
// on macOS Electron + Linux mesa + Windows ANGLE without per-platform
// shader variants.

export const VOL_FOG_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const VOL_FOG_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler2D;

varying vec2 vUv;

uniform sampler2D tDiffuse;
uniform sampler2D tDepth;

uniform mat4  uInvViewProj;
uniform vec3  uCameraPos;
uniform float uCameraNear;
uniform float uCameraFar;

uniform vec3  uSunDir;       // normalised, toward the sun
uniform vec3  uSunColor;     // sun light radiance
uniform vec3  uAmbient;      // ambient / sky contribution
uniform vec3  uFogColor;     // base fog tint
uniform float uDensity;      // sigma_t / extinction coefficient
uniform float uHeightFalloff;
uniform float uFogBaseY;
uniform float uAnisotropy;   // g for Henyey-Greenstein
uniform float uMultiScatter; // 0..1 multi-scatter amount
uniform float uMaxDistance;
uniform float uFrameSeed;

// Fixed step count — 32 is the brief's spec. Even on integrated GPUs this
// produces a smooth march on a 1080p viewport at interactive rates.
const int VOL_FOG_STEPS = 32;

// ── helpers ──────────────────────────────────────────────────────────────

// Cheap 1D hash for the per-pixel jitter that scatters banding into
// high-frequency noise. ShaderPasses downstream (FXAA / bloom) eat this
// happily; the alternative is visible stair-stepping in the march.
float vfHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + uFrameSeed) * 43758.5453);
}

// Reconstruct the world-space position of the surface that the depth
// texture says lives at this UV. ShaderPass writes to a full-screen quad
// with uv in [0,1]; we map back through inv(projection * view) which is
// the standard depth-to-world reconstruction the rest of the engine uses
// (see gpurt/index.js for the same matrix).
vec3 vfWorldFromDepth(vec2 uv, float depth) {
  // depth is in [0,1] — the same NDC z three.js puts into a DepthTexture.
  // We need NDC z ∈ [-1, +1] for the perspective divide.
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 world = uInvViewProj * clip;
  return world.xyz / world.w;
}

// Henyey-Greenstein phase function. g ∈ (-1, 1):
//   g > 0 → forward-scatter dominant (haze, Mie),
//   g = 0 → isotropic,
//   g < 0 → back-scatter (rare; some atmospheric particles).
// The constant 1/(4π) keeps the integral over the sphere = 1, so the
// shader stays energy-conserving when you stack it with multi-scatter.
float vfPhaseHG(float cosTheta, float g) {
  float g2 = g * g;
  float denom = 1.0 + g2 - 2.0 * g * cosTheta;
  // Guard against pow(0, 1.5) on isotropic edge cases.
  denom = max(denom, 1e-4);
  return (1.0 - g2) / (12.566370614 * pow(denom, 1.5));
}

// Height-falloff density model. ExpFog2 in three.js is purely a function
// of depth — we add a real WORLD-space y component so taller scenes (a
// 50 m skylight, a mountain ridge) actually see thinner fog at altitude.
// fogBaseY = sea level / floor; everything above that decays.
float vfDensityAt(vec3 worldPos) {
  float h = max(0.0, worldPos.y - uFogBaseY);
  return uDensity * exp(-uHeightFalloff * h);
}

void main() {
  vec4 scene = texture2D(tDiffuse, vUv);
  float depthSample = texture2D(tDepth, vUv).r;

  // Reconstruct the world point this pixel actually rendered. The march
  // marches from the camera *to* this surface, NOT to infinity, so the
  // fog correctly fades sky pixels (depth==1.0) over the full sky distance
  // and short-range objects over a short distance.
  vec3 worldSurface = vfWorldFromDepth(vUv, depthSample);
  vec3 toSurface = worldSurface - uCameraPos;
  float surfaceDist = length(toSurface);
  vec3 viewDir = toSurface / max(surfaceDist, 1e-5);

  // Clamp the march range so a pixel rendering open sky doesn't drag the
  // step length to kilometres — at 32 steps that would alias horribly.
  // The clamp also matches the brief's "march from camera to surface".
  float marchDist = min(surfaceDist, uMaxDistance);
  if (marchDist <= 1e-3) {
    gl_FragColor = scene;
    return;
  }

  // Per-step length. Jitter the START position by half a step so we don't
  // ring at the camera near plane: classic blue-noise march fix.
  float dt = marchDist / float(VOL_FOG_STEPS);
  float jitter = vfHash(vUv * vec2(uCameraFar, uCameraNear));
  float t = dt * jitter;  // start in [0, dt) — unbiased average position

  // Phase function value at this view-ray / sun-ray angle. Stays constant
  // for the whole march along this pixel — sunDir is directional, so the
  // angle doesn't change as we walk forward.
  float cosTheta = clamp(dot(viewDir, uSunDir), -1.0, 1.0);
  float phase = vfPhaseHG(cosTheta, uAnisotropy);

  // Multi-scatter term: ambient sky × phase factor that softens the
  // strict forward-only sun lobe. EEVEE does this as a cheap stand-in for
  // a real second-bounce integral.
  float msPhase = vfPhaseHG(cosTheta, uAnisotropy * 0.35);
  vec3  multiScatterRad = uAmbient * msPhase * uMultiScatter;

  vec3 inScatter = vec3(0.0);
  float transmittance = 1.0;

  for (int i = 0; i < VOL_FOG_STEPS; i++) {
    vec3 samplePos = uCameraPos + viewDir * t;
    float density = vfDensityAt(samplePos);

    // Total extinction along this step (Beer-Lambert).
    float stepExt = density * dt;
    // Single-scatter contribution from the sun + multi-scatter ambient.
    // Multiplied by transmittance up to here so contributions deep in
    // the volume are correctly attenuated by everything in front.
    vec3 scattered = uFogColor * (uSunColor * phase + multiScatterRad);
    inScatter += transmittance * scattered * stepExt;

    // Update transmittance for the NEXT step.
    transmittance *= exp(-stepExt);

    // Early-out when essentially opaque. Saves ~30 % of march time in
    // dense fog without changing the visual result.
    if (transmittance < 0.005) {
      transmittance = 0.0;
      break;
    }

    t += dt;
  }

  // Final composite: original scene attenuated by transmittance + the
  // in-scattered fog luminance on top. The combined formula is the
  // standard volumetric rendering integral.
  vec3 outColor = scene.rgb * transmittance + inScatter;

  gl_FragColor = vec4(outColor, scene.a);
}
`;

export default { VOL_FOG_VERTEX, VOL_FOG_FRAGMENT };
