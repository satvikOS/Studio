// ArchDisc Studio V3 — REAL Screen-Space Global Illumination (slice 893).
//
// Extends the slice-893 SSAO kernel with a single-bounce colour-bleed
// term — the SSGI / GTAO-Color recipe shipped by Crytek 2010 SSGI,
// NVIDIA Hbao+, and Unreal's screen-space GI fallback.
//
// Algorithm:
//
//   For each pixel P with view-space position pos_P + normal n_P, run
//   the SSAO sample loop but for each hemisphere sample that HITS a
//   nearby occluder also read the COLOUR G-buffer at the sample's
//   screen-space UV and accumulate:
//
//     bounce_P = (1 / N) · Σ visibility(d_i) · albedo_at(uv_i) · cos(θ_i)
//
//   where:
//     - visibility(d_i) = 1 - rangeAttenuation(d_i)   (i.e. close
//       occluders contribute, distant ones don't)
//     - cos(θ_i) is the Lambertian dot of the sample direction with
//       the surface normal (already weighted by the cosine-weighted
//       hemisphere kernel, but we keep it explicit for clarity)
//
//   The final lighting term used by the post-process pass is:
//
//     gi_lit_P = albedo_P · (ao_P · directLight + bounce_P · intensity)
//
//   so we return BOTH the AO buffer AND the bounce-colour buffer; the
//   downstream "apply" op multiplies the bounce in.
//
// This file ships the same deterministic kernel + tangent basis as
// ssao.js so the two passes stay coherent (same hemisphere samples
// → same AO weights → bounce contribution lines up perfectly).
//
// Pure JS. NO new deps. NO Math.random. NO eval / new Function.

import { buildHemisphereKernel, tangentBasisFromNormal, meanAO as _meanAO } from './ssao.js';

// G-buffer helpers (private copies — keeping ssao.js's helpers private
// keeps the module surface tight).
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
function _kernelSamplePos(pos, basis, kx, ky, kz, radius) {
  const dx = basis[0] * kx + basis[3] * ky + basis[6] * kz;
  const dy = basis[1] * kx + basis[4] * ky + basis[7] * kz;
  const dz = basis[2] * kx + basis[5] * ky + basis[8] * kz;
  return [
    pos[0] + radius * dx,
    pos[1] + radius * dy,
    pos[2] + radius * dz,
  ];
}
function _projectToPixel(sample, bbox, width, height) {
  const u = (sample[0] - bbox.minX) / (bbox.maxX - bbox.minX || 1);
  const v = (sample[1] - bbox.minY) / (bbox.maxY - bbox.minY || 1);
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return { ok: false, px: 0, py: 0 };
  return { ok: true, px: u * width, py: v * height };
}

// ── The SSGI kernel ───────────────────────────────────────────────────────
//
// Returns BOTH:
//   - ao:     Float32Array(width*height) — AO weights (see ssao.js)
//   - bounce: Float32Array(width*height*3) — RGB bounce contribution
//
// The bounce buffer is normalised so the max value is ~1 (a fully lit
// red occluder contributes (1,0,0) into the pixel). Downstream "apply"
// scales by `intensity` to taste.
export function computeSSGI(gbuf, opts = {}) {
  const sampleCount = (opts.sampleCount | 0) || 16;
  const radius = (typeof opts.radius === 'number') ? opts.radius : 0.5;
  const bias = (typeof opts.bias === 'number')   ? opts.bias   : 0.025;
  const seed = (opts.seed | 0) || 0xA17F4;
  const { positions, normals, colours, depth, width, height, bbox } = gbuf;
  if (!colours) {
    // SSGI degrades to SSAO when the colour G-buffer is missing — the
    // installer's apply op falls back to the SSAO-only path then.
    return { ok: false, error: 'colour G-buffer required for SSGI' };
  }
  const kernel = buildHemisphereKernel(sampleCount, seed);
  const basis = new Float32Array(9);
  const ao = new Float32Array(width * height);
  const bounce = new Float32Array(width * height * 3);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const pIdx = py * width + px;
      const pIdx3 = pIdx * 3;
      const d_at_p = depth[pIdx];
      if (!isFinite(d_at_p) || d_at_p === 0) { ao[pIdx] = 1; continue; }
      const pos = [positions[pIdx3], positions[pIdx3 + 1], positions[pIdx3 + 2]];
      const nx = normals[pIdx3], ny = normals[pIdx3 + 1], nz = normals[pIdx3 + 2];
      if (nx === 0 && ny === 0 && nz === 0) { ao[pIdx] = 1; continue; }
      tangentBasisFromNormal(nx, ny, nz, basis);
      let occluded = 0;
      let usedSamples = 0;
      let br = 0, bg = 0, bb = 0;
      let bounceN = 0;
      for (let s = 0; s < sampleCount; s++) {
        const kx = kernel[s * 3];
        const ky = kernel[s * 3 + 1];
        const kz = kernel[s * 3 + 2];
        const samplePos = _kernelSamplePos(pos, basis, kx, ky, kz, radius);
        const proj = _projectToPixel(samplePos, bbox, width, height);
        if (!proj.ok) continue;
        usedSamples++;
        const sceneDepth = _sampleFloat(depth, width, height, proj.px, proj.py);
        const sampleDepth = samplePos[2];
        // Range attenuation (close occluders matter, distant don't).
        const range = 1 - Math.min(1, Math.abs(d_at_p - sceneDepth) / radius);
        if (sceneDepth + bias < sampleDepth) {
          // OCCLUSION + BOUNCE COLOUR.
          occluded += range;
          // Sample the colour G-buffer at the hit point and add it,
          // weighted by visibility(range) × cos(θ) where cos(θ) = kz
          // (the kernel's Z component IS the dot with the surface
          // normal since the kernel was generated in tangent space).
          const cosTheta = Math.max(0, kz);
          const col = _sampleVec3(colours, width, height, proj.px, proj.py);
          const w = range * cosTheta;
          br += col[0] * w;
          bg += col[1] * w;
          bb += col[2] * w;
          bounceN++;
        }
      }
      const N = usedSamples || 1;
      ao[pIdx] = Math.max(0, Math.min(1, 1 - (occluded / N)));
      if (bounceN) {
        // Bounce normalisation: divide by N (not bounceN) so unoccluded
        // pixels naturally have low bounce → matches the physical
        // intuition "no nearby surface → no colour bleed".
        bounce[pIdx3]     = br / N;
        bounce[pIdx3 + 1] = bg / N;
        bounce[pIdx3 + 2] = bb / N;
      }
    }
  }
  return { ok: true, ao, bounce, width, height };
}

// ── Apply: composite SSGI on top of an existing beauty buffer ────────────
//
// `beauty` is a Float32Array(width*height*3) of the un-AO'd direct-lit
// pixel colours; we multiply by AO and add `intensity * bounce` and
// return a new buffer.  Used by the install op to demonstrate the final
// composition without writing a fragment shader.
export function applySSGI(beauty, ao, bounce, intensity = 1, width, height) {
  const out = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const i3 = i * 3;
    const a = ao[i];
    out[i3]     = beauty[i3]     * a + bounce[i3]     * intensity;
    out[i3 + 1] = beauty[i3 + 1] * a + bounce[i3 + 1] * intensity;
    out[i3 + 2] = beauty[i3 + 2] * a + bounce[i3 + 2] * intensity;
  }
  return out;
}

// Mean bounce — a useful summary stat (mean luminance of the bounce
// buffer) for the install op return value.
export function meanBounce(bounceBuffer) {
  if (!bounceBuffer || !bounceBuffer.length) return 0;
  let sum = 0;
  const N = bounceBuffer.length / 3;
  for (let i = 0; i < N; i++) {
    const i3 = i * 3;
    // ITU-R BT.601 luminance.
    sum += 0.299 * bounceBuffer[i3] + 0.587 * bounceBuffer[i3 + 1] + 0.114 * bounceBuffer[i3 + 2];
  }
  return sum / N;
}

export const meanAO = _meanAO;

export default computeSSGI;
