// ArchDisc Studio V3 — GPU path tracer installer (Cycles-GPU-preview parity).
//
// installRTGPU() attaches the window.__studioRTGPU* op surface, mounts
// the overlay canvas on Start, and chains a frame callback into the
// viewport's __studioAnimTick pipeline (exactly the same trick the
// slice-684 CPU tracer in rt/index.js uses). Every op is registered
// with the command palette under category 'rt' so both tracers appear
// side-by-side in the palette and can be invoked from agent plans.
//
// Naming: per the slice brief the op surface lives at __studioRTGPU*
// while the CPU tracer keeps __studioRT*. They share the 'rt' category
// because they're variants of the same feature.
//
// The renderer module owns the GPU resources; this module is purely
// glue (lifecycle + state passthrough). Re-calls are idempotent.

import {
  createRenderer,
  probeSupport,
} from './renderer.js';
import {
  mountOverlay,
  unmountOverlay,
  resizeToViewport,
  blitPixels,
  getOverlay,
  snapshotDataUrl,
} from './overlay.js';
import { registerOp } from '../common/registry.js';

let _installed = false;
let _active = false;
let _gpu = null;          // createRenderer() instance
let _support = null;      // probeSupport() result, cached after first check
let _opts = {
  pixelStride: 4,
  maxBounces: 2,
  samplesPerFrame: 1,
};
let _lastBatchMs = 0;
let _lastBatchSamples = 0;
let _tickInstalled = false;

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

function _renderer() {
  const vp = _viewport();
  return (vp && vp.renderer) || null;
}

// Same tick-chain convention as rt/index.js + the wind/spline ticks in
// api.js: wrap whatever's already on __studioAnimTick, tag our function
// with __rtgpu so re-installs don't double-stack, and forward to the
// previous link after our own work.
function _installTick() {
  if (_tickInstalled) return true;
  const vp = _viewport();
  if (!vp) return false;
  const prev = vp.__studioAnimTick;
  const fn = (now) => {
    try {
      if (_active && _gpu) {
        const overlay = getOverlay();
        if (overlay) {
          const resized = resizeToViewport();
          if (resized) {
            // Match the trace target to the new viewport rect.
            _gpu.setSize(overlay.canvas.width, overlay.canvas.height);
            _gpu.resetAccumulation();
          }
          const cam = _camera();
          const t0 = (typeof performance !== 'undefined' && performance.now)
            ? performance.now() : Date.now();
          const out = _gpu.runFrame(cam);
          const t1 = (typeof performance !== 'undefined' && performance.now)
            ? performance.now() : Date.now();
          _lastBatchMs = t1 - t0;
          if (out && out.ok) {
            _lastBatchSamples = out.samples;
            blitPixels(_gpu.traceW, _gpu.traceH, out.pixels);
          }
        }
      }
    } catch (_) {
      // Never break the host loop.
    }
    if (prev) {
      try { prev(now); } catch (_) {}
    }
  };
  fn.__rtgpu = true;
  fn.__prev = prev;
  vp.__studioAnimTick = fn;
  _tickInstalled = true;
  return true;
}

// ── Ops ──────────────────────────────────────────────────────────────────
function rtgpuReady() {
  const r = _renderer();
  if (!r) return { ok: true, supported: false, reason: 'no viewport renderer' };
  if (!_support) _support = probeSupport(r);
  return {
    ok: true,
    supported: !!_support.supported,
    reason: _support.reason || null,
  };
}

function rtgpuStart(overrides) {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  const r = _renderer();
  if (!r) return { ok: false, error: 'no viewport renderer' };
  if (!_support) _support = probeSupport(r);
  if (!_support.supported) {
    // Soft-fail per the slice brief: log clearly and return ok:true so
    // automation can branch on `active`/`supported` without crashing.
    // eslint-disable-next-line no-console
    console.warn('[rtgpu] GPU path tracer unsupported:', _support.reason);
    return { ok: true, active: false, supported: false, reason: _support.reason };
  }
  if (_active && _gpu) {
    return {
      ok: true, active: true, already: true,
      triangles: _gpu.triCount, supported: true,
    };
  }
  if (overrides && typeof overrides === 'object') {
    if (typeof overrides.pixelStride === 'number') _opts.pixelStride = Math.max(1, Math.min(16, overrides.pixelStride | 0));
    if (typeof overrides.maxBounces === 'number') _opts.maxBounces = Math.max(1, Math.min(4, overrides.maxBounces | 0));
    if (typeof overrides.samplesPerFrame === 'number') _opts.samplesPerFrame = Math.max(1, Math.min(16, overrides.samplesPerFrame | 0));
  }
  const mount = mountOverlay();
  if (!mount) return { ok: false, error: 'overlay mount failed' };
  const cw = mount.canvas.width;
  const ch = mount.canvas.height;
  try {
    _gpu = createRenderer({
      renderer: r,
      width: cw,
      height: ch,
      pixelStride: _opts.pixelStride,
      maxBounces: _opts.maxBounces,
      samplesPerFrame: _opts.samplesPerFrame,
    });
  } catch (e) {
    unmountOverlay();
    return { ok: false, error: 'renderer init failed: ' + (e.message || e) };
  }
  const scene = _scene();
  if (scene) _gpu.rebuildScene(scene);
  _active = true;
  _installTick();
  return {
    ok: true,
    active: true,
    supported: true,
    triangles: _gpu.triCount,
    truncated: _gpu.truncated,
  };
}

function rtgpuStop() {
  _active = false;
  unmountOverlay();
  if (_gpu) {
    try { _gpu.dispose(); } catch (_) {}
    _gpu = null;
  }
  _lastBatchMs = 0;
  _lastBatchSamples = 0;
  return { ok: true, active: false };
}

function rtgpuReset() {
  if (!_gpu) return { ok: false, error: 'not running' };
  _gpu.resetAccumulation();
  _lastBatchSamples = 0;
  return { ok: true, samples: 0 };
}

function rtgpuState() {
  return {
    ok: true,
    active: !!_active,
    supported: _support ? _support.supported : null,
    samples: _gpu ? _gpu.samplesPerPixel : 0,
    triCount: _gpu ? _gpu.triCount : 0,
    truncated: _gpu ? _gpu.truncated : false,
    pixelStride: _opts.pixelStride,
    maxBounces: _opts.maxBounces,
    samplesPerFrame: _opts.samplesPerFrame,
    lastBatchMs: _lastBatchMs,
    lastBatchSamples: _lastBatchSamples,
    traceW: _gpu ? _gpu.traceW : 0,
    traceH: _gpu ? _gpu.traceH : 0,
  };
}

function rtgpuSetMaxBounces(n) {
  _opts.maxBounces = Math.max(1, Math.min(4, Math.floor(Number(n) || 2)));
  if (_gpu) _gpu.setMaxBounces(_opts.maxBounces);
  return { ok: true, maxBounces: _opts.maxBounces };
}

function rtgpuSetSamplesPerFrame(n) {
  _opts.samplesPerFrame = Math.max(1, Math.min(16, Math.floor(Number(n) || 1)));
  if (_gpu) _gpu.setSamplesPerFrame(_opts.samplesPerFrame);
  return { ok: true, samplesPerFrame: _opts.samplesPerFrame };
}

function rtgpuSetPixelStride(s) {
  _opts.pixelStride = Math.max(1, Math.min(16, Math.floor(Number(s) || 4)));
  if (_gpu) _gpu.setPixelStride(_opts.pixelStride);
  return { ok: true, pixelStride: _opts.pixelStride };
}

function rtgpuRebuildScene() {
  if (!_gpu) return { ok: false, error: 'not running' };
  const scene = _scene();
  if (!scene) return { ok: false, error: 'no scene' };
  const pack = _gpu.rebuildScene(scene);
  return { ok: true, triCount: pack.triCount, truncated: pack.truncated };
}

function rtgpuGetSnapshot() {
  const url = snapshotDataUrl();
  if (!url) return { ok: false, error: 'no overlay' };
  return { ok: true, dataUrl: url };
}

// ── Command palette registration ─────────────────────────────────────────
//
// Delegates to common/registry.js which handles cold-start retry.
function _reg(name, fn, description) {
  registerOp(name, fn, 'rt', description);
}

export function installRTGPU() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, already: true };
  _installed = true;
  _reg('__studioRTGPUStart', rtgpuStart,
    'Begin GPU fragment-shader path tracer (Cycles-GPU-preview parity).');
  _reg('__studioRTGPUStop', rtgpuStop,
    'Halt GPU path tracer + remove the overlay canvas.');
  _reg('__studioRTGPUReady', rtgpuReady,
    'Probe driver capabilities — { supported, reason? }.');
  _reg('__studioRTGPUGetState', rtgpuState,
    'Read accumulator state, triangle count, batch timings, settings.');
  _reg('__studioRTGPUSetMaxBounces', rtgpuSetMaxBounces,
    'Diffuse bounce cap (1-4, default 2).');
  _reg('__studioRTGPUSetSamplesPerFrame', rtgpuSetSamplesPerFrame,
    'Rays per pixel per frame (1-16, default 1).');
  _reg('__studioRTGPUSetPixelStride', rtgpuSetPixelStride,
    'Trace at 1/N viewport resolution (1=full, 4=quarter, default 4).');
  _reg('__studioRTGPUResetAccumulation', rtgpuReset,
    'Zero the ping-pong accumulator — next frame starts fresh.');
  _reg('__studioRTGPUGetSnapshot', rtgpuGetSnapshot,
    'Capture the current preview as a PNG dataUrl.');
  _reg('__studioRTGPURebuildScene', rtgpuRebuildScene,
    'Re-pack the triangle soup against the live scene graph.');
  return { ok: true, ops: 10 };
}

export function uninstallRTGPU() {
  if (!_installed) return { ok: true };
  try { rtgpuStop(); } catch (_) {}
  const names = [
    '__studioRTGPUStart', '__studioRTGPUStop', '__studioRTGPUReady',
    '__studioRTGPUGetState', '__studioRTGPUSetMaxBounces',
    '__studioRTGPUSetSamplesPerFrame', '__studioRTGPUSetPixelStride',
    '__studioRTGPUResetAccumulation', '__studioRTGPUGetSnapshot',
    '__studioRTGPURebuildScene',
  ];
  for (const n of names) {
    try { delete window[n]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(n); } catch (_) {}
    }
  }
  _installed = false;
  return { ok: true };
}
