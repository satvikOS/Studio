// ArchDisc Studio V3 — path tracer accumulation buffer.
//
// Owns a per-pixel Float32 RGB sum + per-pixel sample-count buffer plus a
// Uint8Clamped display buffer. The accumulator integrates radiance across
// frames; the display buffer is the running mean (sum / count) clamped to
// sRGB byte range, ready to be uploaded into an ImageData on the overlay
// canvas. A single source of truth so pathtracer.js + overlay.js never
// disagree about which pixel is which.
//
// Public API:
//   createBuffer(width, height, pixelStride)
//   resetBuffer(buf)                  // zero sums + counts, bump generation
//   resizeBuffer(buf, w, h, stride?)  // reallocate when canvas size changes
//   recordSample(buf, blockX, blockY, r, g, b)
//   composeImageData(buf)             // returns Uint8ClampedArray w*h*4
//   getSampleStats(buf)               // { samples, blocksFilled, generation }
//
// "blockX/blockY" addresses a stride-sized block (e.g. at stride=4 the
// internal grid is ceil(w/4) × ceil(h/4) blocks). composeImageData then
// upsamples by nearest-neighbour fill so the overlay canvas always
// matches the viewport resolution 1:1 — no scaling artefacts from the
// browser.

const CHANNELS = 3;

function _allocSums(blockCount) {
  return new Float32Array(blockCount * CHANNELS);
}

function _allocCounts(blockCount) {
  // Uint32 is plenty — even at 1000fps you'd need ~50 days to overflow.
  return new Uint32Array(blockCount);
}

function _gridFor(width, height, stride) {
  const s = Math.max(1, Math.min(16, stride | 0));
  const bw = Math.max(1, Math.ceil(width / s));
  const bh = Math.max(1, Math.ceil(height / s));
  return { stride: s, blockW: bw, blockH: bh, blockCount: bw * bh };
}

export function createBuffer(width, height, pixelStride) {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const grid = _gridFor(w, h, pixelStride);
  return {
    width: w,
    height: h,
    ...grid,
    sums: _allocSums(grid.blockCount),
    counts: _allocCounts(grid.blockCount),
    rgba: new Uint8ClampedArray(w * h * 4),
    samples: 0,       // total recordSample() invocations since reset
    blocksFilled: 0,  // count of blocks with at least 1 sample
    generation: 0,    // bumps every reset — overlay uses to skip stale frames
  };
}

export function resetBuffer(buf) {
  if (!buf) return;
  buf.sums.fill(0);
  buf.counts.fill(0);
  // Don't bother clearing rgba — composeImageData will fully repaint.
  buf.samples = 0;
  buf.blocksFilled = 0;
  buf.generation++;
}

export function resizeBuffer(buf, width, height, pixelStride) {
  if (!buf) return;
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const stride = pixelStride != null ? pixelStride : buf.stride;
  const grid = _gridFor(w, h, stride);
  buf.width = w;
  buf.height = h;
  buf.stride = grid.stride;
  buf.blockW = grid.blockW;
  buf.blockH = grid.blockH;
  buf.blockCount = grid.blockCount;
  buf.sums = _allocSums(grid.blockCount);
  buf.counts = _allocCounts(grid.blockCount);
  buf.rgba = new Uint8ClampedArray(w * h * 4);
  buf.samples = 0;
  buf.blocksFilled = 0;
  buf.generation++;
}

export function recordSample(buf, blockX, blockY, r, g, b) {
  if (!buf) return;
  const bx = blockX | 0;
  const by = blockY | 0;
  if (bx < 0 || by < 0 || bx >= buf.blockW || by >= buf.blockH) return;
  const idx = by * buf.blockW + bx;
  const o = idx * CHANNELS;
  const prev = buf.counts[idx];
  buf.sums[o] += r;
  buf.sums[o + 1] += g;
  buf.sums[o + 2] += b;
  buf.counts[idx] = prev + 1;
  buf.samples++;
  if (prev === 0) buf.blocksFilled++;
}

// Linear-to-sRGB approximation (gamma 1/2.2) — matches three.js's
// fallback when no tone mapping is configured. Cheap, no LUT.
function _gamma(v) {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return Math.pow(v, 1 / 2.2);
}

export function composeImageData(buf) {
  if (!buf) return null;
  const { width: w, height: h, stride: s, blockW, sums, counts, rgba } = buf;
  // Walk every pixel; nearest-block lookup is `floor(x/s) + floor(y/s)*bw`.
  // For stride=1 this collapses to a 1:1 mapping. For stride=4 each block
  // fills a 4×4 tile in the rgba buffer.
  for (let y = 0; y < h; y++) {
    const by = (y / s) | 0;
    const rowBase = by * blockW;
    const rowOut = y * w * 4;
    for (let x = 0; x < w; x++) {
      const bx = (x / s) | 0;
      const idx = rowBase + bx;
      const c = counts[idx];
      const out = rowOut + x * 4;
      if (c === 0) {
        rgba[out] = 0;
        rgba[out + 1] = 0;
        rgba[out + 2] = 0;
        rgba[out + 3] = 0; // transparent → wireframe gizmos show through
      } else {
        const o = idx * CHANNELS;
        const inv = 1 / c;
        rgba[out] = (_gamma(sums[o] * inv) * 255) | 0;
        rgba[out + 1] = (_gamma(sums[o + 1] * inv) * 255) | 0;
        rgba[out + 2] = (_gamma(sums[o + 2] * inv) * 255) | 0;
        rgba[out + 3] = 230; // mostly opaque — leaves a hint of wireframe
      }
    }
  }
  return rgba;
}

export function getSampleStats(buf) {
  if (!buf) return { samples: 0, blocksFilled: 0, generation: 0, coverage: 0 };
  return {
    samples: buf.samples,
    blocksFilled: buf.blocksFilled,
    generation: buf.generation,
    coverage: buf.blockCount > 0 ? buf.blocksFilled / buf.blockCount : 0,
  };
}
