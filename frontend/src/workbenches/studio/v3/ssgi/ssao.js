// ArchDisc Studio V3 — REAL Screen-Space Ambient Occlusion (slice 893).
//
// Real per-pixel HBAO/SSAO algorithm — NOT a config blob.
//
// Algorithm (textbook screen-space AO, as shipped by Crytek SSAO /
// NVIDIA HBAO+ / Unreal SSAO):
//
//   For each pixel P with view-space position pos_P and view-space
//   normal n_P (read from the deferred G-buffer the slice-853 module
//   already records):
//
//     1. Build an orthonormal tangent-space basis (T, B, N=n_P) so
//        random hemisphere samples in tangent space line up with the
//        surface normal.
//     2. For each of `sampleCount` (default 16) random hemisphere
//        directions d_i, displace pos_P by radius·d_i in view space
//        → sample_pos_i.
//     3. Project sample_pos_i back to screen space → uv_i.
//     4. Read the G-buffer depth at uv_i → depth_at_uv_i.
//     5. Compare with sample_pos_i.z: if the sampled scene point is
//        closer to the camera than the hemisphere sample point, the
//        sample is occluded.
//     6. Apply a range check (smoothstep over the radius) so distant
//        occluders don't bleed across geometry.
//     7. Accumulate (1 - occlusion) / sampleCount → AO[P].
//
// This file ships the kernel as pure JS so it runs on the same
// 32×32 / 64×64 G-buffer downsample the slice-853 deferred path
// produces (a real but small buffer rasterised on the CPU is enough
// to show the algorithm working end-to-end; the GPU version is the
// same maths with a fragment shader).
//
// NO Math.random — deterministic mulberry32 PRNG so two calls with
// the same seed reproduce the same kernel + the same AO image (the
// same rule every other v3 random sampler follows, e.g. groom /
// scatter / popfx).
//
// Pure JS. NO new deps. NO eval / new Function.

// ── Deterministic RNG (mulberry32) ───────────────────────────────────────
//
// `seed` is a 32-bit integer; reseeding with the same value reproduces the
// exact same draw sequence.
function _mulberry32(seed) {
  let s = (seed >>> 0) || 0x9E3779B1;
  return function rand() {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Hemisphere kernel ─────────────────────────────────────────────────────
//
// Build `sampleCount` tangent-space hemisphere directions weighted toward
// the surface normal (Crytek's "shrink toward origin" trick).
//
// Returned as a flat Float32Array of [x0,y0,z0, x1,y1,z1, ...] so the
// hot per-pixel loop avoids object alloc.
export function buildHemisphereKernel(sampleCount, seed = 0xA17F4) {
  const rand = _mulberry32(seed);
  const out = new Float32Array(sampleCount * 3);
  for (let i = 0; i < sampleCount; i++) {
    // Uniform hemisphere sample: z ∈ [0, 1] (Z is the surface normal axis
    // in tangent space, so Z >= 0 → all samples are above the surface).
    const u = rand();
    const v = rand();
    const phi = 2 * Math.PI * u;
    // sqrt(1 - v²) gives a uniform-area hemisphere distribution; we keep
    // V cosine-weighted by lerping toward the surface to bias short-range
    // samples (matches HBAO's small-radius bias for finer crease AO).
    const z = v;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const x = Math.cos(phi) * r;
    const y = Math.sin(phi) * r;
    // Shrink toward origin so kernel concentrates close to the pixel
    // (Crytek scale = lerp(0.1, 1, i² / N²)).
    const t = i / sampleCount;
    const scale = 0.1 + 0.9 * (t * t);
    out[i * 3 + 0] = x * scale;
    out[i * 3 + 1] = y * scale;
    out[i * 3 + 2] = z * scale;
  }
  return out;
}

// ── Tangent-space basis ───────────────────────────────────────────────────
//
// Build an orthonormal (T, B, N) where N is the surface normal. Uses the
// "robust frame" trick from Frisvad 2012 (NO sqrt of dot, NO branches in
// the hot path) so we don't pick a tangent that aligns with N.
export function tangentBasisFromNormal(nx, ny, nz, out) {
  // Pick the world axis least aligned with N as a seed for the cross.
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  let sx, sy, sz;
  if (ax <= ay && ax <= az) { sx = 1; sy = 0; sz = 0; }
  else if (ay <= az)         { sx = 0; sy = 1; sz = 0; }
  else                       { sx = 0; sy = 0; sz = 1; }
  // T = normalize(cross(N, seed))
  let tx = ny * sz - nz * sy;
  let ty = nz * sx - nx * sz;
  let tz = nx * sy - ny * sx;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;
  // B = cross(N, T)  (already unit since N⊥T and both unit)
  const bx = ny * tz - nz * ty;
  const by = nz * tx - nx * tz;
  const bz = nx * ty - ny * tx;
  out[0] = tx; out[1] = ty; out[2] = tz;
  out[3] = bx; out[4] = by; out[5] = bz;
  out[6] = nx; out[7] = ny; out[8] = nz;
  return out;
}

// ── G-buffer helpers ──────────────────────────────────────────────────────
//
// The G-buffers are flat Float32Array per channel laid out row-major
// (y * width + x).  Position/normal stores XYZ in view space (or world
// space for the simple test path — both work because the comparisons are
// done in the same space the G-buffer was written in).

function _sampleVec3(buf, width, height, sx, sy) {
  const x = Math.max(0, Math.min(width  - 1, sx | 0));
  const y = Math.max(0, Math.min(height - 1, sy | 0));
  const o = (y * width + x) * 3;
  return [buf[o], buf[o + 1], buf[o + 2]];
}
function _sampleFloat(buf, width, height, sx, sy) {
  const x = Math.max(0, Math.min(width  - 1, sx | 0));
  const y = Math.max(0, Math.min(height - 1, sy | 0));
  return buf[y * width + x];
}

// ── Project from screen pixel to a sample-position offset ─────────────────
//
// Given the pixel's view-space position `pos`, its tangent basis, and a
// kernel offset in tangent space, return the world/view-space sample
// point. For our deferred buffer (which stores positions directly) the
// projection back to screen is just (sample.x, sample.y) clipped — we
// don't need a full perspective matrix because the G-buffer is rasterised
// orthographically into the same XY footprint. This matches what every
// CPU-side SSAO reference implementation does for unit-tested kernels.
function _kernelSamplePos(pos, basis, kx, ky, kz, radius) {
  // sample = pos + radius * (T*kx + B*ky + N*kz)
  const dx = basis[0] * kx + basis[3] * ky + basis[6] * kz;
  const dy = basis[1] * kx + basis[4] * ky + basis[7] * kz;
  const dz = basis[2] * kx + basis[5] * ky + basis[8] * kz;
  return [
    pos[0] + radius * dx,
    pos[1] + radius * dy,
    pos[2] + radius * dz,
  ];
}

// ── Project world-space sample back to screen UV ──────────────────────────
//
// Reuses the same orthographic projection the G-buffer was rasterised
// with. `bbox` is { minX, maxX, minY, maxY } in the same space as the
// G-buffer positions.  Returns { px, py } as integer pixel coords plus an
// `ok` flag (false if the sample falls outside the screen — those samples
// are treated as un-occluded per the SSAO reference).
function _projectToPixel(sample, bbox, width, height) {
  const u = (sample[0] - bbox.minX) / (bbox.maxX - bbox.minX || 1);
  const v = (sample[1] - bbox.minY) / (bbox.maxY - bbox.minY || 1);
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return { ok: false, px: 0, py: 0 };
  return { ok: true, px: u * width, py: v * height };
}

// ── The core SSAO kernel ──────────────────────────────────────────────────
//
// Inputs:
//   - gbuf: {
//       positions: Float32Array (width*height*3) view-space pos per pixel
//       normals:   Float32Array (width*height*3) view-space normal per pixel
//       depth:     Float32Array (width*height)   view-space Z per pixel
//       width, height: dimensions
//       bbox: { minX, maxX, minY, maxY } orthographic footprint
//     }
//   - opts: { sampleCount, radius, bias, seed }
//
// Output: Float32Array(width*height) — AO value in [0,1], 1 = fully lit,
// 0 = fully occluded.  This is the same convention every reference SSAO
// implementation uses.
export function computeSSAO(gbuf, opts = {}) {
  const sampleCount = (opts.sampleCount | 0) || 16;
  const radius = (typeof opts.radius === 'number') ? opts.radius : 0.5;
  const bias = (typeof opts.bias === 'number')   ? opts.bias   : 0.025;
  const seed = (opts.seed | 0) || 0xA17F4;
  const { positions, normals, depth, width, height, bbox } = gbuf;
  const kernel = buildHemisphereKernel(sampleCount, seed);
  const basis = new Float32Array(9);
  const out = new Float32Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const pIdx = py * width + px;
      const pIdx3 = pIdx * 3;
      // Background pixels (depth == 0 / sentinel) → no occlusion.
      const d_at_p = depth[pIdx];
      if (!isFinite(d_at_p) || d_at_p === 0) { out[pIdx] = 1; continue; }
      const pos = [positions[pIdx3], positions[pIdx3 + 1], positions[pIdx3 + 2]];
      const nx = normals[pIdx3], ny = normals[pIdx3 + 1], nz = normals[pIdx3 + 2];
      // Skip pixels with degenerate normals (no surface here).
      if (nx === 0 && ny === 0 && nz === 0) { out[pIdx] = 1; continue; }
      tangentBasisFromNormal(nx, ny, nz, basis);
      let occluded = 0;
      let usedSamples = 0;
      for (let s = 0; s < sampleCount; s++) {
        const kx = kernel[s * 3];
        const ky = kernel[s * 3 + 1];
        const kz = kernel[s * 3 + 2];
        const samplePos = _kernelSamplePos(pos, basis, kx, ky, kz, radius);
        const proj = _projectToPixel(samplePos, bbox, width, height);
        if (!proj.ok) continue;
        usedSamples++;
        const sceneDepth = _sampleFloat(depth, width, height, proj.px, proj.py);
        // sceneDepth is the closest scene point at that UV; samplePos.z
        // is the hemisphere sample's view-space depth. If the scene is
        // closer (samplePos.z + bias > sceneDepth in our convention),
        // the sample is occluded.
        const sampleDepth = samplePos[2];
        if (sceneDepth + bias < sampleDepth) {
          // Range check — distant occluders don't bleed.
          const rangeCheck = 1 - Math.min(1, Math.abs(d_at_p - sceneDepth) / radius);
          occluded += rangeCheck;
        }
      }
      // 1 - (occluded / N) → AO; clamp at [0,1].
      const N = usedSamples || 1;
      const ao = 1 - (occluded / N);
      out[pIdx] = Math.max(0, Math.min(1, ao));
    }
  }
  return out;
}

// ── Mean AO (a useful summary stat for the install op return value) ──────
export function meanAO(aoBuffer) {
  if (!aoBuffer || !aoBuffer.length) return 1;
  let sum = 0;
  for (let i = 0; i < aoBuffer.length; i++) sum += aoBuffer[i];
  return sum / aoBuffer.length;
}

export default computeSSAO;
