// ArchDisc Studio V3 — SVGF spatio-temporal denoiser (slice 891).
//
// Real-time denoiser for the path-traced output (slices 684 / 784).
// Implements the Schied et al. 2017 SVGF pipeline:
//
//   raw colour  ──┐
//   normal G-buf ─┼─→ temporal reproject (motion vectors, depth+normal gates)
//   depth G-buf  ─┤
//   motion vec.  ─┘
//                  │
//                  ▼
//             variance estimator  (μ, μ², age → σ²)
//                  │
//                  ▼
//             5-level à-trous wavelet filter (B-3 spline, edge-stop)
//                  │
//                  ▼
//               denoised dataURL
//
// installDenoiser() wires three window ops:
//
//   __studioDenoiserApply({ inputDataUrl, normalDataUrl, depthDataUrl,
//                           motionVectors? }) → { ok, dataUrl, stats }
//   __studioDenoiserSetParams({ sigmaColor, sigmaNormal, sigmaDepth,
//                               atrousIterations }) → { ok, params }
//   __studioDenoiserGetStats() → { ok, stats, params }
//
// Idempotent. Pure JS, no new deps.

import { registerOps } from '../common/registry.js';
import {
  createSvgfState,
  denoise,
  setSvgfParams,
  resetSvgfHistory,
  DEFAULT_PARAMS,
} from './svgf.js';

let _installed = false;
let _state = null;

function _ensureState() {
  if (!_state) _state = createSvgfState();
  return _state;
}

// Decode a dataURL into ImageData via a temp canvas. Returns a Promise.
function _decodeDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    if (typeof dataUrl !== 'string' || !dataUrl) return resolve(null);
    if (typeof Image === 'undefined' || typeof document === 'undefined') {
      return resolve(null);
    }
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = img.width;
        cv.height = img.height;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, img.width, img.height);
        resolve({ data: id.data, width: img.width, height: img.height });
      } catch (e) { reject(e); }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// Encode RGBA → dataURL via a temp canvas.
function _encodeDataUrl(rgba, width, height) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d');
  const id = ctx.createImageData(width, height);
  id.data.set(rgba);
  ctx.putImageData(id, 0, 0);
  return cv.toDataURL('image/png');
}

// Synchronous version of Apply — when used inside a deferred (await)
// context we decode all three dataURLs in parallel then run denoise().
async function applyOp(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const state = _ensureState();

  if (!a.inputDataUrl) return { ok: false, error: 'inputDataUrl required' };

  const [colorImg, normalImg, depthImg] = await Promise.all([
    _decodeDataUrl(a.inputDataUrl),
    _decodeDataUrl(a.normalDataUrl || null),
    _decodeDataUrl(a.depthDataUrl || null),
  ]);
  if (!colorImg) return { ok: false, error: 'failed to decode inputDataUrl' };
  const W = colorImg.width, H = colorImg.height;

  // Motion vectors can be supplied either as a dataURL (encoded into
  // R/G channels) or as a per-mesh array from slice 798's
  // __studioMotionVecCapture. The orchestrator's `denoise()` expects
  // Uint8ClampedArray-packed motion, so we synthesise a flat field
  // here when given the mesh-deltas shape (deferred to a future
  // refinement that walks the depth buffer to associate pixels with
  // mesh uuids).
  let motionData = null;
  if (a.motionVectors) {
    if (typeof a.motionVectors === 'string') {
      const mvImg = await _decodeDataUrl(a.motionVectors);
      if (mvImg && mvImg.width === W && mvImg.height === H) motionData = mvImg.data;
    }
    // Per-mesh array shape → leave motionData null (identity reproject)
    // until we have a uuid G-buffer to splat into. Honest scope.
  }

  // Sanity-check G-buffer sizes match.
  const normalData = (normalImg && normalImg.width === W && normalImg.height === H) ? normalImg.data : null;
  const depthData  = (depthImg  && depthImg.width  === W && depthImg.height  === H) ? depthImg.data  : null;

  const result = denoise(state, {
    colorData: colorImg.data,
    normalData,
    depthData,
    motionData,
    width: W,
    height: H,
  });

  const dataUrl = _encodeDataUrl(result.rgba, W, H);
  return {
    ok: true,
    dataUrl,
    width: W,
    height: H,
    stats: result.stats,
    hadNormal: !!normalData,
    hadDepth: !!depthData,
    hadMotion: !!motionData,
  };
}

function setParamsOp(args) {
  const state = _ensureState();
  const params = setSvgfParams(state, args || {});
  return { ok: true, params };
}

function getStatsOp() {
  const state = _ensureState();
  return {
    ok: true,
    stats: { ...state.stats },
    params: { ...state.params },
    historyAllocated: !!state.history,
    width: state.width,
    height: state.height,
  };
}

function resetOp() {
  const state = _ensureState();
  resetSvgfHistory(state);
  return { ok: true, framesDenoised: 0 };
}

export function installDenoiser() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioDenoiserInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioDenoiserInstalled = true;
  // Pre-create the state so getStats works before the first Apply.
  _ensureState();

  registerOps({
    __studioDenoiserApply: [
      applyOp,
      'SVGF spatio-temporal denoiser — apply à-trous wavelet + temporal reuse to a path-traced dataURL with optional normal/depth/motion G-buffers.'
    ],
    __studioDenoiserSetParams: [
      setParamsOp,
      'SVGF denoiser — tune sigmaColor / sigmaNormal / sigmaDepth / atrousIterations.'
    ],
    __studioDenoiserGetStats: [
      getStatsOp,
      'SVGF denoiser — read current params + last-frame stats.'
    ],
    __studioDenoiserReset: [
      resetOp,
      'SVGF denoiser — clear the temporal history and moment buffers.'
    ],
  }, 'render', 'Real-time SVGF spatio-temporal denoiser (slice 891).');

  return { ok: true, alreadyInstalled: false, defaultParams: { ...DEFAULT_PARAMS } };
}

export default installDenoiser;

// Expose internals for tests / introspection.
export const __internal = {
  state: () => _state,
  decodeDataUrl: _decodeDataUrl,
  encodeDataUrl: _encodeDataUrl,
};
