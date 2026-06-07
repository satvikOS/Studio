// ArchDisc Studio V3 — Temporal Anti-Aliasing shader (slice 916).
//
// REAL GLSL TAA pass following the modern variance-clipping pipeline used
// by Unreal, Unity HDRP, Frostbite, Decima, and Insomniac:
//
//   1. Reproject this pixel's UV through its motion vector to find the
//      sample location in the previous frame (history buffer).
//   2. Sample the current colour (tDiffuse) and the history colour
//      (tHistory) at history-UV.
//   3. Compute the 3×3 neighbourhood AABB of current-frame colours
//      (per-channel min/max). This is the colour "validity box" for
//      the history sample — anything outside means the history is stale
//      (disocclusion, parallax, shading change).
//   4. Clip the history colour to that AABB along the line history→current
//      (Karis 2014 — "Tonemap-Aware Resolve", Salvi 2016 — "An Excursion
//      in TAA"). This is the AABB clip method: gentler than hard clamp,
//      kills ghosting on edges while keeping a long history on
//      stationary regions.
//   5. Blend current + clipped-history with α that grows with motion:
//      α_stationary (low — heavy history weighting → max AA) vs
//      α_fast       (high — quick history fade → no smear on fast motion).
//
// The pass also accepts a uHistoryValid flag — if false (first frame
// after reset / pass enable) we skip the blend and just output the
// current sample so we don't pollute the resolve with stale GPU data.

export const TAA_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const TAA_FRAGMENT = /* glsl */`
  precision highp float;

  varying vec2 vUv;

  uniform sampler2D tDiffuse;        // current frame (composer read buffer)
  uniform sampler2D tHistory;        // previous resolved TAA frame
  uniform sampler2D tMotion;         // RG = screen-space motion vector (px-or-uv space, see uMotionScale)
  uniform vec2      uResolution;     // viewport size in pixels
  uniform float     uHistoryValid;   // 0.0 = first frame, 1.0 = history is usable
  uniform float     uAlphaStill;     // blend α for stationary pixels (low → strong history)
  uniform float     uAlphaMotion;    // blend α for fast-moving pixels (high → fast fade)
  uniform float     uMotionScale;    // converts the motion-vector encoding into UV space
  uniform float     uClampGamma;     // AABB widen factor (1.0 = tight, 1.25 = more permissive)

  // RGB → YCoCg. Variance clipping is canonically done in YCoCg because
  // Y carries most of the visible variance, so the AABB is tighter in
  // perceptually-important directions. We clip in YCoCg then convert back.
  vec3 rgb2ycocg(vec3 c) {
    float y  =  0.25 * c.r + 0.5 * c.g + 0.25 * c.b;
    float co =  0.5  * c.r              - 0.5  * c.b;
    float cg = -0.25 * c.r + 0.5 * c.g - 0.25 * c.b;
    return vec3(y, co, cg);
  }
  vec3 ycocg2rgb(vec3 c) {
    float y = c.x, co = c.y, cg = c.z;
    return vec3(y + co - cg, y + cg, y - co - cg);
  }

  // AABB clip: clip history colour to the box [boxMin, boxMax] along the
  // line history -> current. Returns the intersection point on the box,
  // or the history colour itself if it is already inside the box.
  vec3 clipAABB(vec3 history, vec3 current, vec3 boxMin, vec3 boxMax) {
    vec3 pClip   = 0.5 * (boxMax + boxMin);
    vec3 eClip   = 0.5 * (boxMax - boxMin) + 1e-7;
    vec3 vClip   = history - pClip;
    vec3 vUnit   = vClip / eClip;
    vec3 aUnit   = abs(vUnit);
    float maxA   = max(aUnit.x, max(aUnit.y, aUnit.z));
    if (maxA > 1.0) {
      return pClip + vClip / maxA;
    }
    return history;
  }

  void main() {
    vec2 texel = 1.0 / uResolution;

    // --- Current frame sample + 3×3 neighbourhood AABB in YCoCg ---
    vec3 c00 = rgb2ycocg(texture2D(tDiffuse, vUv + texel * vec2(-1.0, -1.0)).rgb);
    vec3 c10 = rgb2ycocg(texture2D(tDiffuse, vUv + texel * vec2( 0.0, -1.0)).rgb);
    vec3 c20 = rgb2ycocg(texture2D(tDiffuse, vUv + texel * vec2( 1.0, -1.0)).rgb);
    vec3 c01 = rgb2ycocg(texture2D(tDiffuse, vUv + texel * vec2(-1.0,  0.0)).rgb);
    vec3 c11 = rgb2ycocg(texture2D(tDiffuse, vUv                          ).rgb);
    vec3 c21 = rgb2ycocg(texture2D(tDiffuse, vUv + texel * vec2( 1.0,  0.0)).rgb);
    vec3 c02 = rgb2ycocg(texture2D(tDiffuse, vUv + texel * vec2(-1.0,  1.0)).rgb);
    vec3 c12 = rgb2ycocg(texture2D(tDiffuse, vUv + texel * vec2( 0.0,  1.0)).rgb);
    vec3 c22 = rgb2ycocg(texture2D(tDiffuse, vUv + texel * vec2( 1.0,  1.0)).rgb);

    vec3 boxMin = min(c00, min(c10, min(c20, min(c01, min(c11, min(c21, min(c02, min(c12, c22))))))));
    vec3 boxMax = max(c00, max(c10, max(c20, max(c01, max(c11, max(c21, max(c02, max(c12, c22))))))));

    // Karis "Tonemap-Aware Resolve" — widen the box by uClampGamma to
    // accept slightly out-of-range history. 1.0 = strict, 1.25 = lenient.
    vec3 boxCentre = 0.5 * (boxMin + boxMax);
    vec3 boxRadius = 0.5 * (boxMax - boxMin) * uClampGamma;
    boxMin = boxCentre - boxRadius;
    boxMax = boxCentre + boxRadius;

    vec3 currentYCoCg = c11;

    // --- Reproject through motion vector ---
    // tMotion stores per-pixel screen-space motion. We assume R/G encode
    // (Δu, Δv) directly when motion-vec pass is wired; uMotionScale lets
    // the host re-scale (e.g. if the texture stores pixel deltas instead
    // of UV deltas, the host writes uMotionScale = texel).
    vec2 mv     = texture2D(tMotion, vUv).rg;
    vec2 mvUv   = (mv - 0.5) * 2.0 * uMotionScale;  // [-1,1]·scale convention
    vec2 histUv = vUv - mvUv;

    // Off-screen reprojection → history is invalid. Treat as new pixel.
    float histInBounds = step(0.0, histUv.x) * step(histUv.x, 1.0)
                       * step(0.0, histUv.y) * step(histUv.y, 1.0);

    vec3 historyYCoCg = rgb2ycocg(texture2D(tHistory, histUv).rgb);

    // --- AABB clip the history into the neighbourhood box ---
    vec3 clippedYCoCg = clipAABB(historyYCoCg, currentYCoCg, boxMin, boxMax);

    // --- Adaptive blend factor: fast motion → less history ---
    // Speed metric is the length of the motion vector in UV space; a
    // 1-px movement on a 1080p screen is roughly 0.0009 UV units so the
    // ramp 0..16 px is plenty — that's where ghosting starts to bite.
    float speedPx = length(mvUv * uResolution);
    float t = clamp(speedPx / 16.0, 0.0, 1.0);
    float alpha = mix(uAlphaStill, uAlphaMotion, t);

    // First frame after reset / disocclusion → ignore history.
    float effHistoryValid = uHistoryValid * histInBounds;
    alpha = mix(1.0, alpha, effHistoryValid);

    vec3 outYCoCg = mix(clippedYCoCg, currentYCoCg, alpha);
    vec3 outRgb = ycocg2rgb(outYCoCg);

    gl_FragColor = vec4(outRgb, 1.0);
  }
`;

export default { TAA_VERTEX, TAA_FRAGMENT };
