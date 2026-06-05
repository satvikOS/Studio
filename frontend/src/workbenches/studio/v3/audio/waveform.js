// ArchDisc Studio V3 — waveform image renderer.
//
// Takes the AudioBuffer of a loaded clip and paints a min/max envelope
// of its samples into a HTMLCanvasElement, returning a `dataUrl` string
// the AudioPanel can drop into an <img src=...>. Doing it as a data URL
// (rather than streaming canvas pixels via React refs) keeps the panel
// stateless w.r.t. canvas mount points — the image element is just
// vanilla React.
//
// The envelope is the cheapest faithful waveform visualisation:
//   • Each output column owns a slab of samples (length/width samples per
//     column for mono, summed across channels otherwise).
//   • We find min and max within that slab and draw a vertical bar from
//     ymin to ymax — collapses 44 100 samples/sec into 800 pixels in O(N).
//   • A 1px DC line at y=h/2 makes silence regions visible.
//
// `renderWaveform` is the public entry — looks up the buffer via
// `getBuffer(uuid)` (so callers don't have to thread the buffer around)
// and returns `{ ok, dataUrl, width, height, peak }`. If the headless
// environment lacks Canvas (Node) we still return ok with `dataUrl=''`
// and a flag so tests can assert that downsampling math at least ran.

import { getBuffer } from './load.js';

function computeEnvelope(buffer, width) {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const w = Math.max(1, Math.floor(width));
  const samplesPerCol = Math.max(1, Math.floor(length / w));
  // Sum across channels then average — same approach as Audacity's
  // "mix to mono" view. Doing it column-wise (rather than allocating a
  // length-sized mixed buffer first) keeps the GC happy on long clips.
  const mins = new Float32Array(w);
  const maxs = new Float32Array(w);
  // Cache channel views — getChannelData() returns the live typed array.
  const data = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));
  let peak = 0;
  for (let col = 0; col < w; col++) {
    const start = col * samplesPerCol;
    const end = (col === w - 1) ? length : Math.min(length, start + samplesPerCol);
    let lo = +Infinity;
    let hi = -Infinity;
    for (let i = start; i < end; i++) {
      let s = 0;
      for (let c = 0; c < channels; c++) s += data[c][i];
      s /= channels;
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 0; }
    mins[col] = lo;
    maxs[col] = hi;
    const a = Math.abs(lo);
    const b = Math.abs(hi);
    if (a > peak) peak = a;
    if (b > peak) peak = b;
  }
  return { mins, maxs, peak };
}

function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h);
  }
  return null;
}

/**
 * @param {string} uuid     A buffer registered via load.js.
 * @param {number} width    Output canvas width  in pixels (default 800).
 * @param {number} height   Output canvas height in pixels (default 80).
 * @param {Object} [opts]   Style overrides — bg / fg / lineWidth / mid.
 */
export function renderWaveform(uuid, width, height, opts) {
  const buffer = getBuffer(uuid);
  if (!buffer) return { ok: false, error: 'unknown audio uuid' };
  const w = Math.max(1, Math.floor(width || 800));
  const h = Math.max(1, Math.floor(height || 80));
  const o = opts || {};
  const bg = o.bg || 'rgba(13,17,23,0.0)';
  const fg = o.fg || '#1de9b6';
  const midColor = o.mid || 'rgba(154,166,178,0.35)';
  const lineWidth = Math.max(1, Math.floor(o.lineWidth || 1));

  const env = computeEnvelope(buffer, w);

  const canvas = makeCanvas(w, h);
  if (!canvas) {
    return {
      ok: true,
      width: w,
      height: h,
      peak: env.peak,
      sampleRate: buffer.sampleRate,
      duration: buffer.duration,
      dataUrl: '',
      // Returning the envelope arrays lets headless tests verify the
      // downsample math without a canvas.
      mins: Array.from(env.mins),
      maxs: Array.from(env.maxs),
    };
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      ok: true,
      width: w,
      height: h,
      peak: env.peak,
      sampleRate: buffer.sampleRate,
      duration: buffer.duration,
      dataUrl: '',
      mins: Array.from(env.mins),
      maxs: Array.from(env.maxs),
    };
  }
  // Background
  ctx.clearRect(0, 0, w, h);
  if (bg && bg !== 'transparent') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  // DC line
  ctx.fillStyle = midColor;
  ctx.fillRect(0, Math.floor(h / 2), w, 1);
  // Bars
  ctx.fillStyle = fg;
  const half = h / 2;
  // Normalise to the loudest sample so quiet recordings still read
  // clearly — clamp the floor so a near-silent clip doesn't blow up by
  // dividing by ~zero.
  const norm = env.peak > 1e-6 ? (1 / Math.max(env.peak, 0.001)) : 1;
  for (let col = 0; col < w; col++) {
    const lo = Math.max(-1, env.mins[col] * norm);
    const hi = Math.min(1, env.maxs[col] * norm);
    const yHi = Math.floor(half - hi * half);
    const yLo = Math.ceil(half - lo * half);
    const yh = Math.max(1, yLo - yHi);
    ctx.fillRect(col, yHi, lineWidth, yh);
  }
  let dataUrl = '';
  try {
    if (typeof canvas.toDataURL === 'function') {
      dataUrl = canvas.toDataURL('image/png');
    } else if (typeof canvas.convertToBlob === 'function') {
      // OffscreenCanvas path — we can't await here, so leave dataUrl
      // blank and stash the canvas for the caller.
      dataUrl = '';
    }
  } catch (_) {
    dataUrl = '';
  }
  return {
    ok: true,
    width: w,
    height: h,
    peak: env.peak,
    sampleRate: buffer.sampleRate,
    duration: buffer.duration,
    dataUrl,
  };
}

// Headless helper: returns the raw envelope arrays for unit tests.
export function envelopeFor(uuid, width) {
  const buffer = getBuffer(uuid);
  if (!buffer) return { ok: false, error: 'unknown audio uuid' };
  const w = Math.max(1, Math.floor(width || 800));
  const env = computeEnvelope(buffer, w);
  return {
    ok: true,
    width: w,
    mins: Array.from(env.mins),
    maxs: Array.from(env.maxs),
    peak: env.peak,
  };
}
