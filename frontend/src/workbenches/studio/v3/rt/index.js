// ArchDisc Studio V3 — real-time path-traced render preview installer.
//
// installPathTracer() binds the window.__studioRT* op surface, mounts the
// overlay canvas on Start, and chains a frame callback into the viewport's
// __studioAnimTick pipeline so the tracer integrates one ray batch per
// render frame. Idempotent — re-calls return { ok: true, already: true }.
//
// We intentionally do NOT modify api.js or StudioShellV3.jsx. The wiring
// is exactly the same shape as v3/rig + v3/shader: this module's
// autoload.js triggers installPathTracer() on import, and either api.js
// adds `import('./rt/autoload.js')` (the preferred path) or a spec /
// orchestrator dynamic-imports the autoload module directly. Both paths
// converge on the same install function.

import {
  createState,
  rebuildScene,
  rayBatch,
  hashCamera,
} from './pathtracer.js';
import {
  createBuffer,
  resetBuffer,
  resizeBuffer,
  getSampleStats,
} from './buffer.js';
import {
  mountOverlay,
  unmountOverlay,
  resizeToViewport,
  paintBuffer,
  snapshotDataUrl,
  getOverlay,
} from './overlay.js';
import { registerOp } from '../common/registry.js';

let _installed = false;
let _state = null;
let _active = false;
let _tickInstalled = false;
let _rebuildScheduled = false;

function _viewport() {
  return (typeof window !== 'undefined') ? window.__archdiscViewport : null;
}

function _scene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || ((_viewport() || {}).scene)
    || null;
}

function _camera() {
  const vp = _viewport();
  return (vp && vp.camera) || null;
}

// ── Install the per-frame tick into __studioAnimTick chain ───────────────
//
// Same chain convention as api.js's wind / spline ticks. We tag our
// added tick fn with `__rt` so re-installs are idempotent and previous
// links are preserved.
function _installTick() {
  if (_tickInstalled) return true;
  const vp = _viewport();
  if (!vp) return false;
  const prev = vp.__studioAnimTick;
  const fn = (now) => {
    try {
      if (_active && _state) {
        const overlay = getOverlay();
        if (overlay) {
          // Keep canvas size in sync with the viewport.
          const resized = resizeToViewport(_state.buffer);
          if (resized) {
            // After a resize the camera basis & block count changed —
            // reset so we don't paint blocks against stale geometry.
            resetBuffer(_state.buffer);
            _state.lastCamHash = hashCamera(_camera());
          }
          // Camera-move detection.
          const cam = _camera();
          if (cam) {
            _state.camera = cam;
            const h = hashCamera(cam);
            if (h !== _state.lastCamHash) {
              resetBuffer(_state.buffer);
              _state.lastCamHash = h;
            }
          }
          rayBatch(_state, now);
          paintBuffer(_state.buffer);
        }
      }
    } catch (_) {
      // Hot path swallow — never break the viewport render loop.
    }
    if (prev) {
      try { prev(now); } catch (_) {}
    }
  };
  fn.__rt = true;
  fn.__prev = prev;
  vp.__studioAnimTick = fn;
  _tickInstalled = true;
  return true;
}

// ── Rebuild the triangle soup against the current scene ──────────────────
//
// We lazily rebuild when Start is called, when the scene mesh count
// changes meaningfully, or via __studioRTRebuildScene(). The rebuild is
// O(triangles) so we don't want to run it every frame.
function _rebuild() {
  if (!_state) return 0;
  const scene = _scene();
  if (!scene) return 0;
  return rebuildScene(_state, scene);
}

// ── Op surface (window.__studioRT*) ──────────────────────────────────────
function rtStart(opts) {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  const vp = _viewport();
  if (!vp) return { ok: false, error: 'no viewport' };
  if (!_state) _state = createState();
  // Apply optional overrides up-front so the first frame reflects them.
  if (opts && typeof opts === 'object') {
    if (typeof opts.pixelStride === 'number') _state._pendingStride = opts.pixelStride;
    if (typeof opts.maxSamples === 'number') _state.maxSamples = Math.max(1, opts.maxSamples | 0);
    if (typeof opts.maxBounces === 'number') _state.maxBounces = Math.max(1, Math.min(4, opts.maxBounces | 0));
    if (typeof opts.budgetMs === 'number') _state.budgetMs = Math.max(1, opts.budgetMs);
    if (typeof opts.maxRaysPerFrame === 'number') _state.maxRaysPerFrame = Math.max(64, opts.maxRaysPerFrame | 0);
  }
  const mount = mountOverlay();
  if (!mount) return { ok: false, error: 'overlay mount failed' };
  // Allocate / resize buffer to match the overlay canvas.
  const cw = mount.canvas.width;
  const ch = mount.canvas.height;
  const stride = _state._pendingStride || (_state.buffer && _state.buffer.stride) || 4;
  if (!_state.buffer) {
    _state.buffer = createBuffer(cw, ch, stride);
  } else {
    resizeBuffer(_state.buffer, cw, ch, stride);
  }
  _rebuild();
  _state.camera = _camera();
  _state.lastCamHash = hashCamera(_state.camera);
  _active = true;
  _installTick();
  return { ok: true, active: true, triangles: _state.soup ? _state.soup.count : 0 };
}

function rtStop() {
  _active = false;
  unmountOverlay();
  return { ok: true, active: false };
}

function rtReset() {
  if (!_state || !_state.buffer) return { ok: false, error: 'not running' };
  resetBuffer(_state.buffer);
  return { ok: true, samples: 0 };
}

function rtState() {
  if (!_state) {
    return { ok: true, active: false, samples: 0, pixelStride: 4, triangles: 0 };
  }
  const stats = getSampleStats(_state.buffer);
  return {
    ok: true,
    active: _active,
    samples: stats.samples,
    coverage: stats.coverage,
    pixelStride: _state.buffer ? _state.buffer.stride : 4,
    triangles: _state.soup ? _state.soup.count : 0,
    maxSamples: _state.maxSamples,
    maxBounces: _state.maxBounces,
    budgetMs: _state.budgetMs,
    maxRaysPerFrame: _state.maxRaysPerFrame,
    lastBatchMs: _state.lastBatchMs,
    lastBatchRays: _state.lastBatchRays,
  };
}

function rtSetMaxSamples(n) {
  if (!_state) _state = createState();
  _state.maxSamples = Math.max(1, Math.floor(Number(n) || 1));
  return { ok: true, maxSamples: _state.maxSamples };
}

function rtSetPixelStride(s) {
  if (!_state) _state = createState();
  const stride = Math.max(1, Math.min(16, Math.floor(Number(s) || 4)));
  _state._pendingStride = stride;
  if (_state.buffer) {
    resizeBuffer(_state.buffer, _state.buffer.width, _state.buffer.height, stride);
  }
  return { ok: true, pixelStride: stride };
}

function rtGetSnapshot() {
  // Force a final paint so the overlay reflects the latest accumulator state.
  if (_state && _state.buffer) paintBuffer(_state.buffer);
  const url = snapshotDataUrl();
  if (!url) return { ok: false, error: 'no overlay' };
  return { ok: true, dataUrl: url };
}

function rtRebuildScene() {
  const n = _rebuild();
  if (_state && _state.buffer) resetBuffer(_state.buffer);
  return { ok: true, triangles: n };
}

function rtSetMaxBounces(n) {
  if (!_state) _state = createState();
  _state.maxBounces = Math.max(1, Math.min(4, Math.floor(Number(n) || 2)));
  if (_state.buffer) resetBuffer(_state.buffer);
  return { ok: true, maxBounces: _state.maxBounces };
}

function rtSetBudgetMs(ms) {
  if (!_state) _state = createState();
  _state.budgetMs = Math.max(1, Math.min(100, Number(ms) || 10));
  return { ok: true, budgetMs: _state.budgetMs };
}

function rtSetMaxRaysPerFrame(n) {
  if (!_state) _state = createState();
  _state.maxRaysPerFrame = Math.max(64, Math.min(50000, Math.floor(Number(n) || 4000)));
  return { ok: true, maxRaysPerFrame: _state.maxRaysPerFrame };
}

// ── Command palette registration ─────────────────────────────────────────
//
// Mirrors the rig + shader patterns: bind every op to window.__studioRT*,
// then register each entry with __studioCommandRegister under category
// 'rt'. Delegates to common/registry.js which handles cold-start retry.
function _reg(name, fn, description) {
  registerOp(name, fn, 'rt', description);
}

export function installPathTracer() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  // Core lifecycle ops named per the slice brief.
  _reg('__studioRTStart', rtStart,
    'Begin progressive path-traced render preview (mounts overlay).');
  _reg('__studioRTStop', rtStop,
    'Halt path tracer + remove the overlay canvas.');
  _reg('__studioRTResetAccumulation', rtReset,
    'Zero the accumulation buffer so the next frame starts from scratch.');
  _reg('__studioRTGetState', rtState,
    'Read accumulated samples, coverage, pixel stride, soup size, last frame stats.');
  _reg('__studioRTSetMaxSamples', rtSetMaxSamples,
    'Stop accumulating after this many total samples (per buffer reset).');
  _reg('__studioRTSetPixelStride', rtSetPixelStride,
    'Block size in CSS pixels — 1=full-res, 4=quarter-res (default).');
  _reg('__studioRTGetSnapshot', rtGetSnapshot,
    'Capture the current accumulated preview as a PNG data URL.');

  // Bonus ops — auxiliary control surfaces still under category 'rt'.
  _reg('__studioRTRebuildScene', rtRebuildScene,
    'Re-rasterise the scene into the triangle soup (call after large scene edits).');
  _reg('__studioRTSetMaxBounces', rtSetMaxBounces,
    'Max diffuse bounces per ray (1-4, default 2).');
  _reg('__studioRTSetBudgetMs', rtSetBudgetMs,
    'Per-frame CPU budget in ms (default 10).');
  _reg('__studioRTSetMaxRaysPerFrame', rtSetMaxRaysPerFrame,
    'Hard cap on rays cast per frame even if the budget allows more.');

  return { ok: true, ops: 11 };
}

export function uninstallPathTracer() {
  if (!_installed) return { ok: true };
  try { rtStop(); } catch (_) {}
  const names = [
    '__studioRTStart', '__studioRTStop', '__studioRTResetAccumulation',
    '__studioRTGetState', '__studioRTSetMaxSamples', '__studioRTSetPixelStride',
    '__studioRTGetSnapshot', '__studioRTRebuildScene', '__studioRTSetMaxBounces',
    '__studioRTSetBudgetMs', '__studioRTSetMaxRaysPerFrame',
  ];
  for (const n of names) {
    try { delete window[n]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(n); } catch (_) {}
    }
  }
  _installed = false;
  _state = null;
  _active = false;
  void _rebuildScheduled;
  return { ok: true };
}
