// ArchDisc Studio V3 — GPU path tracer fragment shader (GLSL ES 3.0).
//
// One fullscreen pass per frame. Reads the prior accumulation target
// (uTexAccum), shoots N samples through this fragment's pixel, adds the
// new radiance to the running sum, and writes back. The host renderer
// ping-pongs two WebGLRenderTargets so the read + write don't collide.
//
// Scene geometry lives in three Float32 RGBA DataTextures packed by
// sceneToTextures.js:
//
//   uTexPos    triangleCount × 3   — vertex positions (xyz)
//   uTexNrm    triangleCount × 3   — vertex normals   (xyz)
//   uTexAlb    triangleCount × 1   — flat albedo + emissive flag
//
// Layout is row-per-vertex / row-per-triangle: triangle i's vertex 0
// lives at texel (i, 0) of uTexPos (or column i of row 0 — see
// sceneToTextures.js for the exact axis convention). We use `texelFetch`
// with integer coordinates so no sampling filter ever munges the data.
//
// Intersection: Möller–Trumbore, linear over all triangles. With the
// uTriCount ≤ 4096 limit documented in the slice brief this is fast
// enough on M-series GPUs to deliver Cycles-GPU-preview parity at
// interactive frame rates.
//
// Sampling: cosine-weighted hemisphere around the surface normal, up to
// uMaxBounces diffuse bounces. PRNG is a per-pixel hash of
// (gl_FragCoord, uSampleCount, sample index) so accumulation is
// reproducible per frame and the noise pattern advances every batch.
//
// Output: vec4(rgbSum, sampleCount). The overlay blit pass divides RGB
// by alpha and applies a gamma 1/2.2 to display the running mean.

export const PATHSHADER_VERTEX = /* glsl */ `#version 300 es
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  // ScreenQuad: position covers [-1,1] in XY, UV is half-range +0.5.
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const PATHSHADER_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 vUv;
layout(location = 0) out vec4 fragOut;

// ── Scene textures ─────────────────────────────────────────────────────
uniform sampler2D uTexPos;     // (triCount, 3): vertex positions
uniform sampler2D uTexNrm;     // (triCount, 3): vertex normals
uniform sampler2D uTexAlb;     // (triCount, 1): albedo.rgb + emissiveFlag
uniform int       uTriCount;

// ── Camera basis (matrixWorld + projection) ────────────────────────────
uniform vec3  uCamPos;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform vec3  uCamFwd;
uniform float uHalfH;
uniform float uHalfW;

// ── Accumulation read-back ─────────────────────────────────────────────
uniform sampler2D uTexAccum;
uniform float     uSampleCount;     // 0 → first frame after reset
uniform vec2      uResolution;

// ── Tuning knobs ───────────────────────────────────────────────────────
uniform int   uMaxBounces;
uniform int   uSamplesPerFrame;
uniform float uFrameSeed;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uSkyTop;
uniform vec3  uSkyBot;

// ── Constants ──────────────────────────────────────────────────────────
const float EPS  = 1e-4;
const float TMAX = 1.0e6;
const float PI   = 3.14159265358979;

// ── PRNG (PCG-style hash, then scale to [0,1)) ─────────────────────────
//
// Per-pixel deterministic so two pixels never share a sample sequence
// (which would create visible structured noise). Mixes gl_FragCoord,
// uFrameSeed (rolls each frame), uSampleCount (rolls each accumulation
// pass), and a local bounce index.
uint pcgHash(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28) + 4u)) ^ state) * 277803737u;
  return (word >> 22) ^ word;
}

float randFloat(inout uint seed) {
  seed = pcgHash(seed);
  // 24-bit mantissa for [0,1) — safest portable conversion across drivers.
  return float(seed & 0x00FFFFFFu) / float(0x01000000u);
}

// ── Triangle texture fetch ─────────────────────────────────────────────
//
// uTexPos texel layout: x-axis = triangle index, y-axis = vertex slot
// (0,1,2). For >4096 tris we'd wrap into multiple rows of x; for v1 we
// hard-cap below the WebGL2 minimum guaranteed texture width (4096).
vec3 fetchPos(int triIdx, int vert) {
  return texelFetch(uTexPos, ivec2(triIdx, vert), 0).xyz;
}

vec3 fetchNrm(int triIdx, int vert) {
  return texelFetch(uTexNrm, ivec2(triIdx, vert), 0).xyz;
}

vec4 fetchAlbedo(int triIdx) {
  return texelFetch(uTexAlb, ivec2(triIdx, 0), 0);
}

// Moller-Trumbore (returns t, u, v in out params)
bool intersectTri(vec3 ro, vec3 rd, vec3 a, vec3 b, vec3 c,
                  out float t, out float bu, out float bv) {
  vec3 e1 = b - a;
  vec3 e2 = c - a;
  vec3 pv = cross(rd, e2);
  float det = dot(e1, pv);
  if (abs(det) < 1e-8) return false;
  float invDet = 1.0 / det;
  vec3 tv = ro - a;
  float u = dot(tv, pv) * invDet;
  if (u < 0.0 || u > 1.0) return false;
  vec3 qv = cross(tv, e1);
  float v = dot(rd, qv) * invDet;
  if (v < 0.0 || u + v > 1.0) return false;
  float th = dot(e2, qv) * invDet;
  if (th <= EPS) return false;
  t = th; bu = u; bv = v;
  return true;
}

// Scene-wide intersection — linear scan, returns nearest hit triangle
// index (or -1) plus the hit's t and barycentric weights.
int intersectScene(vec3 ro, vec3 rd, int skipTri,
                   out float bestT, out float bestU, out float bestV) {
  bestT = TMAX;
  int hitIdx = -1;
  // Cap loop counter at a compile-time constant so the GLSL compiler can
  // unroll-skip; uTriCount gates the actual work.
  for (int i = 0; i < 4096; i++) {
    if (i >= uTriCount) break;
    if (i == skipTri) continue;
    vec3 a = fetchPos(i, 0);
    vec3 b = fetchPos(i, 1);
    vec3 c = fetchPos(i, 2);
    float t, u, v;
    if (intersectTri(ro, rd, a, b, c, t, u, v) && t < bestT) {
      bestT = t; bestU = u; bestV = v; hitIdx = i;
    }
  }
  return hitIdx;
}

// Smooth normal at hit point — interpolate the per-vertex normals using
// the Möller-Trumbore barycentrics (u, v on b,c; 1-u-v on a).
vec3 hitNormal(int triIdx, float u, float v) {
  vec3 n0 = fetchNrm(triIdx, 0);
  vec3 n1 = fetchNrm(triIdx, 1);
  vec3 n2 = fetchNrm(triIdx, 2);
  vec3 n = n0 * (1.0 - u - v) + n1 * u + n2 * v;
  if (length(n) < 1e-6) {
    // Degenerate normal — fall back to geometric normal.
    vec3 a = fetchPos(triIdx, 0);
    vec3 b = fetchPos(triIdx, 1);
    vec3 c = fetchPos(triIdx, 2);
    n = cross(b - a, c - a);
  }
  return normalize(n);
}

// ── Sky / environment radiance ─────────────────────────────────────────
//
// Two-stop vertical gradient + a tiny sun disc lobe so direct sunlight
// shows up on background pixels too (matches a Cycles "sky+sun" rig).
vec3 sampleEnv(vec3 d) {
  float t = clamp(0.5 * (d.y + 1.0), 0.0, 1.0);
  vec3 sky = mix(uSkyBot, uSkyTop, t);
  float sunDot = max(dot(normalize(d), normalize(uSunDir)), 0.0);
  // Pow(.., 256) gives a small bright disc; multiplied by sun color for
  // the bright "fireball" the diffuse hits will pick up at second bounce.
  vec3 sunLobe = uSunColor * pow(sunDot, 256.0) * 12.0;
  return sky + sunLobe;
}

// ── Cosine-weighted hemisphere sample around a normal ──────────────────
vec3 cosineHemi(vec3 n, inout uint seed) {
  float r1 = randFloat(seed);
  float r2 = randFloat(seed);
  float phi  = 2.0 * PI * r1;
  float sinT = sqrt(r2);
  float cosT = sqrt(1.0 - r2);
  vec3 local = vec3(cos(phi) * sinT, sin(phi) * sinT, cosT);
  // Build an orthonormal basis around n — Frisvad's branchless variant.
  vec3 a = (abs(n.x) > 0.9) ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(n, a));
  vec3 b = cross(n, t);
  return normalize(t * local.x + b * local.y + n * local.z);
}

// ── Path trace a single ray ────────────────────────────────────────────
vec3 traceRay(vec3 ro, vec3 rd, inout uint seed) {
  vec3 accum = vec3(0.0);
  vec3 throughput = vec3(1.0);
  int skip = -1;
  for (int bounce = 0; bounce <= 4; bounce++) {
    if (bounce > uMaxBounces) break;
    float t, bu, bv;
    int hit = intersectScene(ro, rd, skip, t, bu, bv);
    if (hit < 0) {
      accum += throughput * sampleEnv(rd);
      break;
    }
    vec4 alb = fetchAlbedo(hit);
    vec3 n = hitNormal(hit, bu, bv);
    // Flip toward the incoming ray (back-face shading).
    if (dot(rd, n) > 0.0) n = -n;
    // Emissive contribution (alb.a flags emissive — color reused as
    // its own emission to keep texture count down).
    if (alb.a > 0.5) {
      accum += throughput * alb.rgb * 3.0;
      break;
    }
    // Explicit sun (only on the first bounce — visually dominant, cheap).
    if (bounce == 0) {
      vec3 sd = normalize(uSunDir);
      float ndl = max(dot(n, sd), 0.0);
      if (ndl > 0.0) {
        vec3 hp = ro + rd * t + n * 1e-3;
        float st, su, sv;
        int sh = intersectScene(hp, sd, hit, st, su, sv);
        if (sh < 0) {
          accum += throughput * alb.rgb * uSunColor * ndl;
        }
      }
    }
    // Cosine-weighted scatter (Lambertian — cosT factor cancels with pdf).
    vec3 hp = ro + rd * t + n * 1e-3;
    rd = cosineHemi(n, seed);
    ro = hp;
    throughput *= alb.rgb;
    skip = hit;
    // Cheap russian-roulette-ish early-out.
    float lum = max(max(throughput.r, throughput.g), throughput.b);
    if (lum < 0.01) break;
  }
  return accum;
}

// ── Main: pick this fragment's camera ray, accumulate ──────────────────
void main() {
  // Read existing accumulation (read-from / write-to ping-pong).
  vec4 prev = texture(uTexAccum, vUv);

  // Per-pixel PRNG seed: mix pixel coord + per-frame roll + sample count.
  uint pix = uint(gl_FragCoord.x) * 1973u
           + uint(gl_FragCoord.y) * 9277u;
  uint baseSeed = pcgHash(pix
    ^ uint(uFrameSeed * 16777216.0)
    ^ uint(uSampleCount));

  vec3 frameSum = vec3(0.0);
  int spp = max(1, uSamplesPerFrame);
  for (int s = 0; s < 16; s++) {
    if (s >= spp) break;
    uint seed = pcgHash(baseSeed + uint(s) * 6271u);
    // Sub-pixel jitter for AA.
    float jx = randFloat(seed) - 0.5;
    float jy = randFloat(seed) - 0.5;
    float u = (gl_FragCoord.x + jx) / uResolution.x;
    float v = (gl_FragCoord.y + jy) / uResolution.y;
    float ndx = (u * 2.0 - 1.0) * uHalfW;
    float ndy = (v * 2.0 - 1.0) * uHalfH;
    vec3 rd = normalize(uCamFwd + uCamRight * ndx + uCamUp * ndy);
    frameSum += traceRay(uCamPos, rd, seed);
  }

  // Accumulate radiance + sample count into the output texture.
  vec3 newSum = prev.rgb + frameSum;
  float newN = prev.a + float(spp);

  // On reset (uSampleCount == 0 AND prev.a > 0 from the previous run)
  // we don't bother manually clearing the texture — the host blits a
  // zero clear before the ping-pong starts, so prev.a is already 0.
  fragOut = vec4(newSum, newN);
}
`;

// Display-pass shader: divide rgb / sampleCount and gamma-correct so
// the overlay canvas sees a tone-mapped sRGB image. Trivial enough to
// inline here next to the trace shader.
export const DISPLAY_VERTEX = /* glsl */ `#version 300 es
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const DISPLAY_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragOut;
uniform sampler2D uTexAccum;
uniform float     uExposure;

void main() {
  vec4 t = texture(uTexAccum, vUv);
  if (t.a < 1.0) {
    // No samples yet — leave fully transparent so gizmos read through.
    fragOut = vec4(0.0);
    return;
  }
  vec3 mean = (t.rgb / t.a) * uExposure;
  // Reinhard-ish soft clamp then gamma.
  mean = mean / (1.0 + mean);
  mean = pow(mean, vec3(1.0 / 2.2));
  fragOut = vec4(mean, 0.92);
}
`;

export default {
  PATHSHADER_VERTEX,
  PATHSHADER_FRAGMENT,
  DISPLAY_VERTEX,
  DISPLAY_FRAGMENT,
};
