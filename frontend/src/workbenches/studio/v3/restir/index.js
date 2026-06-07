// ArchDisc Studio V3 — ReSTIR direct-lighting installer (slice 792).
//
// `installReSTIR()` registers the window.__studioReSTIR* op surface:
//
//   __studioReSTIREnable({on,M,spatialPasses}) → { ok, enabled, M, spatialPasses }
//   __studioReSTIRRender({width,height,samples}) → { ok, dataUrl, stats }
//   __studioReSTIRGetStats() → { ok, ... }
//
// Builds on slice 684 (`v3/rt/pathtracer.js`) — we reuse its triangle-soup
// builder for the geometry side, then plug it into our own reservoir grid
// + ReSTIR sampler. The soup rebuild on Enable picks up emissive
// triangles from the scene's actual materials so users see real lights.
//
// Idempotent — re-calls return { ok: true, alreadyInstalled: true }. The
// install is wired into `frontend/src/.../v3/api.js` autoload chain via
// `./autoload.js` (mirroring rt/shader/rig modules).

import { registerOps, unregisterOps } from '../common/registry.js';
import { buildSoup } from '../rt/pathtracer.js';
import {
  createSamplerState,
  rebuildFromScene,
  renderReSTIR,
} from './restirSampler.js';

let _installed = false;
let _state = null;

function _scene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function _camera() {
  if (typeof window === 'undefined') return null;
  return (window.__archdiscViewport && window.__archdiscViewport.camera) || null;
}

function _ensureState() {
  if (!_state) _state = createSamplerState();
  return _state;
}

function _rebuild() {
  const s = _scene();
  if (!s) return 0;
  const soup = buildSoup(s);
  const st = _ensureState();
  st.camera = _camera();
  return rebuildFromScene(st, s, soup);
}

// ─── Buffer → PNG dataURL via a temp canvas ──────────────────────────────
function _rgbToDataUrl(rgb, width, height) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 3;
    const j = i * 4;
    // Reinhard-ish tone map + gamma 1/2.2 → 8-bit sRGB.
    const r = rgb[o]     / (1 + rgb[o]);
    const g = rgb[o + 1] / (1 + rgb[o + 1]);
    const b = rgb[o + 2] / (1 + rgb[o + 2]);
    img.data[j]     = Math.min(255, Math.max(0, (Math.pow(r, 1 / 2.2) * 255) | 0));
    img.data[j + 1] = Math.min(255, Math.max(0, (Math.pow(g, 1 / 2.2) * 255) | 0));
    img.data[j + 2] = Math.min(255, Math.max(0, (Math.pow(b, 1 / 2.2) * 255) | 0));
    img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

// ─── Op implementations ──────────────────────────────────────────────────

function enableOp(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const st = _ensureState();
  if (typeof a.on === 'boolean') st.enabled = a.on;
  else st.enabled = true;
  if (typeof a.M === 'number') st.M = Math.max(1, Math.min(64, a.M | 0));
  if (typeof a.spatialPasses === 'number') {
    st.spatialPasses = Math.max(0, Math.min(8, a.spatialPasses | 0));
  }
  let lightCount = 0;
  if (st.enabled) {
    lightCount = _rebuild();
  }
  return {
    ok: true,
    enabled: st.enabled,
    M: st.M,
    spatialPasses: st.spatialPasses,
    lights: lightCount,
  };
}

function renderOp(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const st = _ensureState();
  if (!st.enabled) return { ok: false, error: 'ReSTIR is disabled — call __studioReSTIREnable first.' };
  // Rebuild scene state right before render so the soup + lights are
  // current. This is cheaper than caching invalidation hooks at the cost
  // of a one-time O(triangles) walk per Render call — fine for a slow
  // user-driven button (not a per-frame tick).
  _rebuild();
  if (!st.soup || st.soup.count === 0) return { ok: false, error: 'no traceable geometry in scene' };
  if (!st.camera) return { ok: false, error: 'no viewport camera' };
  const result = renderReSTIR(st, {
    width: a.width,
    height: a.height,
    samples: a.samples,
  });
  if (!result.ok) return { ok: false, error: result.error || 'render failed' };
  const dataUrl = _rgbToDataUrl(result.rgb, result.width, result.height);
  return {
    ok: true,
    dataUrl,
    width: result.width,
    height: result.height,
    samples: result.samples,
    stats: result.stats,
  };
}

function getStatsOp() {
  const st = _ensureState();
  return {
    ok: true,
    enabled: st.enabled,
    M: st.M,
    spatialPasses: st.spatialPasses,
    lights: st.lights ? st.lights.count : 0,
    triangles: st.soup ? st.soup.count : 0,
    width: st.lastWidth,
    height: st.lastHeight,
    samples: st.lastSamples,
    hits: st.lastHitCount,
    elapsedMs: st.lastRenderMs,
  };
}

// ─── Install ─────────────────────────────────────────────────────────────
export function installReSTIR() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioReSTIRInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioReSTIRInstalled = true;
  registerOps({
    __studioReSTIREnable: [enableOp,
      'ReSTIR direct-lighting — toggle on/off + set candidates M and spatial reuse passes; rebuilds the scene\'s light table.'],
    __studioReSTIRRender: [renderOp,
      'ReSTIR direct-lighting — render a {width,height} image with N samples per pixel; returns a PNG dataURL.'],
    __studioReSTIRGetStats: [getStatsOp,
      'ReSTIR direct-lighting — read M, spatial passes, light count, last frame stats.'],
  }, 'render', 'Real-time ReSTIR direct-lighting path tracer (slice 792).');
  return { ok: true, alreadyInstalled: false };
}

export function uninstallReSTIR() {
  if (!_installed) return { ok: true };
  unregisterOps([
    '__studioReSTIREnable',
    '__studioReSTIRRender',
    '__studioReSTIRGetStats',
  ]);
  _installed = false;
  _state = null;
  if (typeof window !== 'undefined') window.__studioReSTIRInstalled = false;
  return { ok: true };
}

export const __internal = { _state: () => _state };

export default installReSTIR;
