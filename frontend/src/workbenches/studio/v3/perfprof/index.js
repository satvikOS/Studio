// ArchDisc Studio V3 — performance profiler / FPS overlay (slice 881).
// Per-frame FPS + frame time + draw call count + memory in a DOM overlay.

import { registerOps } from '../common/registry.js';
let _installed = false;
let _overlay = null;
let _stats = { fps: 60, frameTimeMs: 16.6, drawCalls: 0, triangles: 0, points: 0, jsHeap: 0 };
let _last = performance.now();
let _frames = 0;
let _hookInstalled = false;
function _ensureOverlay() {
  if (_overlay || typeof document === 'undefined') return _overlay;
  _overlay = document.createElement('div');
  _overlay.id = 'archdisc-perf-overlay';
  Object.assign(_overlay.style, {
    position: 'fixed', top: '10px', right: '10px', padding: '8px 12px',
    background: 'rgba(0,0,0,0.7)', color: '#0f0', fontFamily: 'monospace',
    fontSize: '11px', zIndex: '9998', pointerEvents: 'none', borderRadius: '3px',
  });
  document.body.appendChild(_overlay);
  return _overlay;
}
function _tick() {
  const now = performance.now();
  const delta = now - _last;
  _frames++;
  if (delta >= 1000) {
    _stats.fps = Math.round((_frames * 1000) / delta);
    _stats.frameTimeMs = +(delta / _frames).toFixed(2);
    _frames = 0; _last = now;
    const vp = window.__archdiscViewport;
    if (vp?.renderer?.info) {
      const info = vp.renderer.info;
      _stats.drawCalls = info.render?.calls || 0;
      _stats.triangles = info.render?.triangles || 0;
      _stats.points = info.render?.points || 0;
    }
    if (performance?.memory) _stats.jsHeap = Math.round(performance.memory.usedJSHeapSize / 1048576);
    if (_overlay) _overlay.textContent = `FPS:${_stats.fps} FT:${_stats.frameTimeMs}ms DC:${_stats.drawCalls} TRI:${_stats.triangles} HEAP:${_stats.jsHeap}MB`;
  }
}
function _hook() {
  if (_hookInstalled) return; _hookInstalled = true;
  const vp = window.__archdiscViewport;
  if (vp) { const prev = vp.__studioAnimTick; vp.__studioAnimTick = (n) => { prev?.(n); _tick(); }; }
  else { setInterval(_tick, 16); }
}
export function installPerfProf() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioPerfShow: () => { _ensureOverlay(); _hook(); return { ok: true }; },
    __studioPerfHide: () => { if (_overlay) { _overlay.remove(); _overlay = null; } return { ok: true }; },
    __studioPerfGetStats: () => ({ ok: true, ..._stats }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Performance profiler');
  return { ok: true };
}
export default installPerfProf;
