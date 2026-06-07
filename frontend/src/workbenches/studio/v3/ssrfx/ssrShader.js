// ArchDisc Studio V3 — slice 915 — REAL screen-space reflection ShaderPass.
//
// True view-space ray-march SSR (not the cheap UV-space variant used by
// v3/eevee/ssr.frag.js).  Per fragment we:
//
//   1. Decode the non-linear depth at the centre pixel and reconstruct the
//      view-space position (origin O) via the inverse projection matrix.
//   2. Decode the view-space normal (N) from the dedicated normal G-buffer
//      (filled with three.js MeshNormalMaterial, which writes view-space
//      normal as RGB = N*0.5+0.5).
//   3. Compute the reflection vector R = reflect(normalize(O), N) in view
//      space.  Two view-space endpoints (O + small offset, O + maxDistance
//      * R) get projected back to clip space then to UV — that gives us a
//      proper screen-space line whose endpoints correspond to a real
//      world-space ray.
//   4. March between those UV endpoints in `samples` linear steps.  At
//      every step we also linearly interpolate the ray's view-space z
//      (using the perspective-correct (1/z) interpolation that matches
//      the rasterisation pipeline) and compare it with the view-space z
//      reconstructed from the depth buffer at the sampled UV.
//   5. First step whose ray-z is *behind* the depth-buffer-z (with a small
//      tolerance) is treated as a hit.  Binary-refine the hit between the
//      previous and current step for sharper contact and sample tDiffuse
//      at the refined UV.
//   6. Fade by:
//        - distance travelled (fadeStart → maxDistance)
//        - screen-edge proximity (smoothstep on min(uv, 1-uv))
//        - view-facing dot(N, V) (heavily-grazing surfaces get muted)
//
// Uniforms expected by the host (see ./index.js):
//   tDiffuse       sampler2D  composer's previous-pass colour
//   tDepth         sampler2D  depth texture (non-linear z, hyperbolic)
//   tNormal        sampler2D  view-space normals encoded as RGB*0.5+0.5
//   uProjection    mat4       perspective matrix used at aux-render time
//   uInverseProj   mat4       inverse of uProjection
//   uResolution    vec2       canvas pixels
//   uMaxDistance   float      max view-space length of the reflected ray
//   uFadeStart     float      0..1 fraction of uMaxDistance where fade starts
//   uSamples       int        screen-march step count (8..64)
//   uIntensity     float      output mix factor
//   uThickness     float      view-space thickness for hit acceptance
//   uFrameSeed     float      per-frame jitter (anti-aliasing the march)

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

uniform mat4  uProjection;
uniform mat4  uInverseProj;
uniform vec2  uResolution;
uniform float uMaxDistance;
uniform float uFadeStart;
uniform int   uSamples;
uniform float uIntensity;
uniform float uThickness;
uniform float uFrameSeed;

// Hard ceiling on the loop so the GLSL compiler can unroll if it wants;
// the runtime uSamples uniform clamps within this range.
const int SSR_MAX_STEPS = 64;

// Per-pixel hash, cheap stripe-breaker.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Reconstruct view-space position from depth-buffer sample at UV.  Three's
// DepthTexture stores window-space z (0..1, non-linear).  Standard
// reconstruction: build clip-space (uv*2-1, depth*2-1, 1) and multiply by
// the inverse projection, then perspective-divide.
vec3 viewPosFromDepth(vec2 uv, float depth) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uInverseProj * clip;
  return view.xyz / view.w;
}

// Project a view-space point back to UV space + window-space depth.
// Returns vec3(uv.x, uv.y, depth01).  If w <= 0 (behind camera) we mark
// the result by setting depth = -1 so callers can early-out.
vec3 projectViewToUv(vec3 viewPos) {
  vec4 clip = uProjection * vec4(viewPos, 1.0);
  if (clip.w <= 0.0) return vec3(-1.0);
  vec3 ndc = clip.xyz / clip.w;
  return vec3(ndc.xy * 0.5 + 0.5, ndc.z * 0.5 + 0.5);
}

void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  float centreDepth = texture2D(tDepth, vUv).r;

  // Sky / background → nothing to reflect.
  if (centreDepth >= 0.99999) {
    gl_FragColor = base;
    return;
  }

  // View-space position of this fragment.
  vec3 viewOrigin = viewPosFromDepth(vUv, centreDepth);

  // View-space normal.
  vec3 nEncoded = texture2D(tNormal, vUv).xyz;
  // MeshNormalMaterial writes (N*0.5+0.5) in world OR view space depending
  // on whether the material is overridden mid-render.  Our host renders
  // the normal pass with MeshNormalMaterial which is view-space.
  vec3 N = normalize(nEncoded * 2.0 - 1.0);

  // View vector (from fragment toward camera) — origin in view space
  // already has the camera at 0, so the incident direction is normalize(O).
  vec3 V = normalize(viewOrigin);

  // Reflect the incident vector about the normal.  In three.js view space
  // the camera looks down -Z, so a flat ground-plane normal points +Y;
  // the reflected direction stays in view space and is what we'll march.
  vec3 R = reflect(V, N);

  // If the reflection points back into the surface (R · N < 0 due to
  // normal-map / encoding noise) or sharply away from the camera, bail.
  if (dot(R, N) < 0.01) {
    gl_FragColor = base;
    return;
  }

  // Compute the view-space endpoint of the ray.
  vec3 viewEnd = viewOrigin + R * uMaxDistance;

  // Project both endpoints to UV+depth.
  vec3 startUvD = projectViewToUv(viewOrigin);
  vec3 endUvD   = projectViewToUv(viewEnd);

  if (startUvD.z < 0.0 || endUvD.z < 0.0) {
    // One endpoint is behind the camera → can't ray-march this fragment.
    gl_FragColor = base;
    return;
  }

  vec2 uvDelta = endUvD.xy - startUvD.xy;
  // Convert UV delta to pixel-space so we can decide how many steps to take.
  vec2 pxDelta = uvDelta * uResolution;
  float pxLen = length(pxDelta);
  if (pxLen < 1.0) {
    // Reflection covers less than a pixel → nothing useful.
    gl_FragColor = base;
    return;
  }

  // Choose step count: prefer uSamples but cap so step size >= 1 pixel.
  int steps = uSamples;
  if (steps < 8)  steps = 8;
  if (steps > SSR_MAX_STEPS) steps = SSR_MAX_STEPS;
  float stepsF = float(steps);

  // Per-fragment temporal jitter so the march doesn't snap to integer
  // step offsets — visible as a "step" pattern on shiny floors.
  float jitter = hash12(vUv * uResolution + uFrameSeed * 117.31);

  vec2  prevUv   = startUvD.xy;
  float prevRayZ = viewOrigin.z;
  float prevSceneZ = viewOrigin.z;
  bool  hit = false;
  vec2  hitUv = vec2(0.0);
  float hitT  = 0.0;

  for (int i = 1; i <= SSR_MAX_STEPS; i++) {
    if (i > steps) break;

    float t = (float(i) + jitter) / stepsF;
    if (t > 1.0) t = 1.0;

    vec2 uvI = mix(startUvD.xy, endUvD.xy, t);

    // Bail if we walk off-screen.
    if (uvI.x < 0.0 || uvI.x > 1.0 || uvI.y < 0.0 || uvI.y > 1.0) break;

    // Perspective-correct interpolation of view-space z along the ray.
    // (1/z) is linear in screen space, so we lerp 1/z and invert.
    float invStart = 1.0 / viewOrigin.z;
    float invEnd   = 1.0 / viewEnd.z;
    float invZ = mix(invStart, invEnd, t);
    float rayZ = 1.0 / invZ;

    // Depth-buffer reconstruction at the sampled UV.
    float dSample = texture2D(tDepth, uvI).r;
    if (dSample >= 0.99999) {
      // Hit the sky — nothing in front of us at this UV.
      prevUv = uvI;
      prevRayZ = rayZ;
      prevSceneZ = rayZ; // keep moving
      continue;
    }
    vec3 viewSample = viewPosFromDepth(uvI, dSample);
    float sceneZ = viewSample.z;

    // In three.js view space the camera looks down -Z, so points further
    // from the camera have *more negative* z.  "Ray behind the surface"
    // means the ray's z is more negative than the scene's z at this pixel
    // (we've gone past the silhouette into the geometry).
    float deltaZ = rayZ - sceneZ;          // negative when ray is past scene
    float thickness = uThickness;

    if (deltaZ < 0.0 && deltaZ > -thickness) {
      // Refine between previous and current step with a fixed-iteration
      // binary search.  Always-mid is fine for this short range — 4 iters
      // gets us sub-pixel accuracy without unrolling cost.
      vec2 lo = prevUv;
      vec2 hi = uvI;
      float loZ = prevRayZ;
      float hiZ = rayZ;
      float prevSZ = prevSceneZ;
      vec2 mid = uvI;
      for (int b = 0; b < 4; b++) {
        mid = (lo + hi) * 0.5;
        float midZ = (loZ + hiZ) * 0.5;
        float dM = texture2D(tDepth, mid).r;
        vec3 vM = viewPosFromDepth(mid, dM);
        if (midZ - vM.z < 0.0) {
          // Still past the scene → tighten upper bound.
          hi = mid;
          hiZ = midZ;
        } else {
          lo = mid;
          loZ = midZ;
        }
        prevSZ = vM.z;
      }
      hit = true;
      hitUv = mid;
      hitT = t;
      break;
    }

    prevUv = uvI;
    prevRayZ = rayZ;
    prevSceneZ = sceneZ;
  }

  if (!hit) {
    gl_FragColor = base;
    return;
  }

  // Distance fade — t∈[0..1] maps to view-space [0..uMaxDistance].
  float distFade = 1.0;
  if (hitT > uFadeStart) {
    distFade = 1.0 - (hitT - uFadeStart) / max(0.0001, 1.0 - uFadeStart);
    distFade = clamp(distFade, 0.0, 1.0);
    distFade = distFade * distFade;     // ease-out
  }

  // Screen-edge fade so reflections don't pop at the viewport border.
  vec2 edgeDist = min(hitUv, vec2(1.0) - hitUv);
  float edgeFade = smoothstep(0.0, 0.08, min(edgeDist.x, edgeDist.y));

  // Grazing-angle fade (Fresnel-like, cheap).
  float NdotV = clamp(-dot(N, V), 0.0, 1.0);
  float grazeFade = mix(0.4, 1.0, NdotV);  // grazing pixels weigh ~0.4

  float weight = distFade * edgeFade * grazeFade * uIntensity;

  vec3 reflCol = texture2D(tDiffuse, hitUv).rgb;
  // Add reflection on top of base — not a full replace, so existing
  // shading still reads through.  Clamp to avoid HDR blowout.
  vec3 outCol = base.rgb + reflCol * weight;
  outCol = clamp(outCol, 0.0, 8.0);

  gl_FragColor = vec4(outCol, base.a);
}
`;

// ShaderPass-compatible blueprint: pass `new ShaderPass(SSRShader)` to
// get a usable pass.  Host code overwrites the uniform values via
// `pass.uniforms.<x>.value = …` before each render.
//
// We do NOT import THREE in this module — host wires up the Matrix4 /
// Vector2 instances so this file stays a pure shader source unit.
export const SSRShader = {
  defines: {},
  uniforms: {
    tDiffuse:     { value: null },
    tDepth:       { value: null },
    tNormal:      { value: null },
    uProjection:  { value: null },   // host fills with new THREE.Matrix4()
    uInverseProj: { value: null },   // host fills with new THREE.Matrix4()
    uResolution:  { value: null },   // host fills with new THREE.Vector2()
    uMaxDistance: { value: 4.0 },
    uFadeStart:   { value: 0.7 },
    uSamples:     { value: 24 },
    uIntensity:   { value: 1.0 },
    uThickness:   { value: 0.5 },
    uFrameSeed:   { value: 0.0 },
  },
  vertexShader: SSR_VERTEX,
  fragmentShader: SSR_FRAGMENT,
};

export default SSRShader;
