// Slice 702 — Offline Cycles-style path tracer.

import { registerOps } from '../common/registry.js';
import { renderTiled } from './raytrace.js';

let _installed = false;
let _lastCanvas = null;

export function installCyclesBake() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioCyclesBakeRender: (opts) => {
      return new Promise((resolve) => {
        renderTiled({
          ...opts,
          onProgress: (p, cv) => {
            window.__studioCyclesBakeLastProgress = p;
            _lastCanvas = cv;
          },
          onComplete: (res) => {
            _lastCanvas = res.canvas;
            resolve(res);
          },
        });
      });
    },
    __studioCyclesBakeGetLastCanvas: () => _lastCanvas,
    __studioCyclesBakeGetLastDataURL: () => _lastCanvas ? _lastCanvas.toDataURL('image/png') : null,
    __studioCyclesBakeOpenLastInNewTab: () => {
      if (!_lastCanvas) return { ok: false };
      const url = _lastCanvas.toDataURL('image/png');
      const w = window.open(); if (w) w.document.write(`<img src="${url}" style="image-rendering:pixelated">`);
      return { ok: true };
    },
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rt', 'Cycles-style offline path-traced bake (CPU, full BRDF)');
}
