// ArchDisc Studio V3 — SVGF orchestrator (slice 891).
//
// Wires the temporal reprojection, variance estimator, and à-trous
// wavelet filter into the Schied 2017 "Spatiotemporal Variance-Guided
// Filtering" pipeline:
//
//   1.  Decode input + G-buffer (colour, normal, depth, motion).
//   2.  Reproject the history (colour, moments) using motion vectors.
//   3.  Update the temporal first + second moments → variance buffer.
//   4.  Run N levels of à-trous wavelet filter with edge-stopping.
//   5.  Feed the filtered colour back into the history.
//
// The orchestrator owns the history buffers and the current SVGF params.
// `denoise()` is the single per-frame entry-point.
//
// Pure JS, no deps.

import { atrousMultiLevel, DEFAULT_STRIDES } from './atrous.js';
import {
  bufferToLuma,
  createMomentState,
  updateMoments,
  resetMoments,
  estimateVariance,
} from './variance.js';
import {
  reprojectLuma,
} from './reproject.js';

export const DEFAULT_PARAMS = {
  sigmaColor: 4.0,
  sigmaNormal: 128.0,
  sigmaDepth: 1.0,
  atrousIterations: 5,
  alpha: 0.2,        // temporal-blend weight for the colour history.
  alphaMoments: 0.2, // temporal-blend weight for the moment history.
};

export function createSvgfState() {
  return {
    width: 0, height: 0,
    history: null,        // Float32Array[W*H] — last filtered luma channel.
    historyR: null,       // Float32Array[W*H] — last filtered R.
    historyG: null,       // Float32Array[W*H] — last filtered G.
    historyB: null,       // Float32Array[W*H] — last filtered B.
    momentLuma: null,     // moment state (variance.js)
    prevDepth: null,
    prevNormal: null,
    params: { ...DEFAULT_PARAMS },
    stats: {
      lastFrameMs: 0,
      framesDenoised: 0,
      reprojectedPct: 0,
      atrousIterations: DEFAULT_PARAMS.atrousIterations,
    },
  };
}

function _ensureBuffers(state, width, height) {
  if (state.width === width && state.height === height && state.history) return;
  state.width = width;
  state.height = height;
  state.history  = new Float32Array(width * height);
  state.historyR = new Float32Array(width * height);
  state.historyG = new Float32Array(width * height);
  state.historyB = new Float32Array(width * height);
  state.momentLuma = createMomentState(width, height);
  state.prevDepth = new Float32Array(width * height);
  state.prevNormal = new Float32Array(width * height * 3);
}

// Per-channel à-trous pass, sharing the same edge-stop geometry
// (variance + normal + depth) computed from luma.
function _filterChannel(channel, variance, normal, depth, width, height, params, iters) {
  const strides = DEFAULT_STRIDES.slice(0, iters);
  return atrousMultiLevel(
    { colour: channel, variance, normal, depth, width, height },
    {
      sigmaColor: params.sigmaColor,
      sigmaNormal: params.sigmaNormal,
      sigmaDepth: params.sigmaDepth,
    },
    strides,
  );
}

// Convert a Uint8ClampedArray (ImageData.data) → three Float32 channels.
function _rgbChannels(data, width, height) {
  const n = width * height;
  const R = new Float32Array(n);
  const G = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    R[i] = data[j]     / 255;
    G[i] = data[j + 1] / 255;
    B[i] = data[j + 2] / 255;
  }
  return { R, G, B };
}

// Decode a normal G-buffer Uint8ClampedArray (R,G,B = unsigned (n+1)/2)
// → Float32Array[W*H*3] of unit vectors. When data is null we fall back
// to a flat-z normal field so the edge stops act as no-ops.
function _decodeNormals(data, width, height) {
  const out = new Float32Array(width * height * 3);
  if (!data) {
    for (let i = 0; i < width * height; i++) { out[i * 3 + 2] = 1; }
    return out;
  }
  for (let i = 0; i < width * height; i++) {
    const j = i * 4;
    out[i * 3]     = (data[j]     / 255) * 2 - 1;
    out[i * 3 + 1] = (data[j + 1] / 255) * 2 - 1;
    out[i * 3 + 2] = (data[j + 2] / 255) * 2 - 1;
    // Renormalise.
    const x = out[i * 3], y = out[i * 3 + 1], z = out[i * 3 + 2];
    const L = Math.sqrt(x * x + y * y + z * z) || 1;
    out[i * 3]     = x / L;
    out[i * 3 + 1] = y / L;
    out[i * 3 + 2] = z / L;
  }
  return out;
}

// Decode a depth G-buffer (luminance encoded in R channel) → Float32.
function _decodeDepth(data, width, height) {
  const out = new Float32Array(width * height);
  if (!data) return out;
  for (let i = 0; i < width * height; i++) {
    out[i] = data[i * 4] / 255;
  }
  return out;
}

// Decode a motion-vector field (R = dx, G = dy, scaled to [0..255]
// centred on 128) → Float32Array length W*H*2 of pixel deltas.
function _decodeMotion(data, width, height) {
  const out = new Float32Array(width * height * 2);
  if (!data) return out;
  for (let i = 0; i < width * height; i++) {
    out[i * 2]     = (data[i * 4]     - 128) * 0.5;
    out[i * 2 + 1] = (data[i * 4 + 1] - 128) * 0.5;
  }
  return out;
}

// Main per-frame denoise.
//
// inputs:
//   colorData   — Uint8ClampedArray (RGBA from path-traced ImageData)
//   normalData  — Uint8ClampedArray (G-buffer normal) — may be null
//   depthData   — Uint8ClampedArray (G-buffer depth)  — may be null
//   motionData  — Uint8ClampedArray (motion vectors)   — may be null
//   width, height
//
// Returns { rgba, stats } where rgba is a fresh Uint8ClampedArray
// ready to be put back onto a canvas.
export function denoise(state, {
  colorData, normalData, depthData, motionData, width, height,
}) {
  const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  _ensureBuffers(state, width, height);

  // ── Decode ───────────────────────────────────────────────────────────
  const { R, G, B } = _rgbChannels(colorData, width, height);
  const lumaCur = bufferToLuma(colorData, width, height);
  const normalCur = _decodeNormals(normalData, width, height);
  const depthCur  = _decodeDepth(depthData, width, height);
  const motion    = _decodeMotion(motionData, width, height);

  // ── Reproject the history ────────────────────────────────────────────
  const params = state.params;
  const lumaRepro = reprojectLuma({
    prevBuf: state.history,
    motionVectors: motion,
    prevDepth: state.prevDepth,
    curDepth: depthCur,
    prevNormal: state.prevNormal,
    curNormal: normalCur,
    width, height,
  });
  const reproR = reprojectLuma({
    prevBuf: state.historyR,
    motionVectors: motion,
    prevDepth: state.prevDepth, curDepth: depthCur,
    prevNormal: state.prevNormal, curNormal: normalCur,
    width, height,
  });
  const reproG = reprojectLuma({
    prevBuf: state.historyG,
    motionVectors: motion,
    prevDepth: state.prevDepth, curDepth: depthCur,
    prevNormal: state.prevNormal, curNormal: normalCur,
    width, height,
  });
  const reproB = reprojectLuma({
    prevBuf: state.historyB,
    motionVectors: motion,
    prevDepth: state.prevDepth, curDepth: depthCur,
    prevNormal: state.prevNormal, curNormal: normalCur,
    width, height,
  });

  // ── Temporal-blend each channel with its reprojected history ─────────
  const a = params.alpha;
  for (let i = 0; i < width * height; i++) {
    if (lumaRepro.validity[i]) {
      R[i] = (1 - a) * reproR.out[i] + a * R[i];
      G[i] = (1 - a) * reproG.out[i] + a * G[i];
      B[i] = (1 - a) * reproB.out[i] + a * B[i];
      lumaCur[i] = (1 - a) * lumaRepro.out[i] + a * lumaCur[i];
    } else {
      // Disocclusion — drop the moment age for this pixel so the spatial
      // variance estimator takes over (variance.js).
      state.momentLuma.age[i] = 0;
    }
  }

  // ── Update temporal moments + variance ───────────────────────────────
  updateMoments(state.momentLuma, lumaCur, params.alphaMoments);
  const variance = estimateVariance(state.momentLuma, lumaCur);

  // ── À-trous wavelet filter (per RGB channel) ─────────────────────────
  const iters = Math.max(1, Math.min(8, params.atrousIterations | 0));
  const filteredR = _filterChannel(R, variance, normalCur, depthCur, width, height, params, iters);
  const filteredG = _filterChannel(G, variance, normalCur, depthCur, width, height, params, iters);
  const filteredB = _filterChannel(B, variance, normalCur, depthCur, width, height, params, iters);

  // The colour-history feedback uses the result AFTER the first à-trous
  // pass (Schied §4.4 — feeds back the "feedback" image, not the final
  // image, so detail isn't progressively destroyed across frames).
  // We approximate by feeding back the final filtered colour weighted
  // with the raw input — production SVGF separates feedback vs final
  // buffers; the orchestrator stores both.

  // ── Pack RGBA → out ──────────────────────────────────────────────────
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const j = i * 4;
    out[j]     = Math.max(0, Math.min(255, Math.round(filteredR.colour[i] * 255)));
    out[j + 1] = Math.max(0, Math.min(255, Math.round(filteredG.colour[i] * 255)));
    out[j + 2] = Math.max(0, Math.min(255, Math.round(filteredB.colour[i] * 255)));
    out[j + 3] = 255;
  }

  // ── Save history ─────────────────────────────────────────────────────
  // Feed back the colour AFTER the first à-trous pass for the history;
  // re-running 1 level keeps detail without over-blurring across frames.
  const firstLevel = _filterChannel(R, variance, normalCur, depthCur, width, height, params, 1);
  state.historyR.set(firstLevel.colour);
  const firstLevelG = _filterChannel(G, variance, normalCur, depthCur, width, height, params, 1);
  state.historyG.set(firstLevelG.colour);
  const firstLevelB = _filterChannel(B, variance, normalCur, depthCur, width, height, params, 1);
  state.historyB.set(firstLevelB.colour);
  // Luma history: re-derive from the channel histories.
  for (let i = 0; i < width * height; i++) {
    state.history[i] = 0.2126 * state.historyR[i] + 0.7152 * state.historyG[i] + 0.0722 * state.historyB[i];
  }
  // Save G-buffers as the next frame's history.
  state.prevDepth.set(depthCur);
  state.prevNormal.set(normalCur);

  // ── Stats ────────────────────────────────────────────────────────────
  let reprojected = 0;
  for (let i = 0; i < width * height; i++) if (lumaRepro.validity[i]) reprojected++;
  state.stats.lastFrameMs = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - t0;
  state.stats.framesDenoised++;
  state.stats.reprojectedPct = 100 * reprojected / (width * height);
  state.stats.atrousIterations = iters;
  state.stats.width = width;
  state.stats.height = height;

  return { rgba: out, stats: { ...state.stats } };
}

export function setSvgfParams(state, partial) {
  if (!partial) return { ...state.params };
  for (const k of ['sigmaColor', 'sigmaNormal', 'sigmaDepth', 'alpha', 'alphaMoments']) {
    if (typeof partial[k] === 'number' && isFinite(partial[k])) state.params[k] = partial[k];
  }
  if (typeof partial.atrousIterations === 'number' && isFinite(partial.atrousIterations)) {
    state.params.atrousIterations = Math.max(1, Math.min(8, partial.atrousIterations | 0));
  }
  return { ...state.params };
}

export function resetSvgfHistory(state) {
  if (state.history)   state.history.fill(0);
  if (state.historyR)  state.historyR.fill(0);
  if (state.historyG)  state.historyG.fill(0);
  if (state.historyB)  state.historyB.fill(0);
  if (state.prevDepth) state.prevDepth.fill(0);
  if (state.prevNormal) state.prevNormal.fill(0);
  if (state.momentLuma) resetMoments(state.momentLuma);
  state.stats.framesDenoised = 0;
}

export default {
  createSvgfState,
  denoise,
  setSvgfParams,
  resetSvgfHistory,
  DEFAULT_PARAMS,
};
