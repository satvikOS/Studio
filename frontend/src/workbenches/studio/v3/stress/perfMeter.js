// ArchDisc Studio V3 — stress test FPS / frame-time meter (slice 788).
//
// Wraps `requestAnimationFrame` to clock real frame-time for a fixed
// `durationMs` window, then reports `{fps, frameTimeMs, frameCount,
// minFrameMs, maxFrameMs, samples?, gpuMs?}`.
//
// The honest measurement model: the perf meter does NOT call
// `renderer.render` itself — it relies on the slice-752 render-on-demand
// loop in `Viewport3D.jsx`, which schedules a draw whenever the scene
// is dirty. To keep the slice-752 dirty-flag set for the entire
// measurement window we call `window.__studioInvalidate()` once per
// rAF tick so the gate never short-circuits. Without this, the meter
// would report ~rAF-cadence (60 Hz on idle) but ZERO actual draws.
//
// `gpuMs` is best-effort: when the WebGL2 `EXT_disjoint_timer_query`
// extension is reachable through `renderer.info.render.frame` we can
// approximate per-frame GPU time, but it isn't exposed through THREE's
// public surface in r0.181 — we report `undefined` for it and let the
// CPU-side `frameTimeMs` carry the signal. (Bytes-on-the-wire honest:
// no shim, no fabricated number.)
//
// Pure JS, no new deps.

// Measure FPS over `durationMs` milliseconds. Returns a Promise that
// resolves to a stats payload when the window closes.
//
// Args:
//   durationMs:    number — how long to clock (default 1000).
//   includeSamples:boolean — if true, returns the full frame-time array
//                  (default false — keeps the payload light for cross-
//                  boundary calls).
//   forceRender:   boolean — if true, call `window.__studioInvalidate()`
//                  every rAF tick so the slice-752 gate never sleeps
//                  during the measurement window (default true).
//
// Returns Promise<{
//   ok:           boolean,
//   fps:          number,
//   frameTimeMs:  number,  // mean frame time
//   frameCount:   number,
//   minFrameMs:   number,
//   maxFrameMs:   number,
//   medianFrameMs:number,
//   durationMs:   number,
//   gpuMs?:       number,
//   samples?:     number[],
// }>
export function measureFPS(opts) {
  const o = opts || {};
  const durationMs = Number.isFinite(+o.durationMs) ? Math.max(50, +o.durationMs) : 1000;
  const includeSamples = !!o.includeSamples;
  const forceRender = o.forceRender !== false; // default true

  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') {
      resolve({
        ok: false,
        error: 'no requestAnimationFrame',
        fps: 0, frameTimeMs: 0, frameCount: 0,
        minFrameMs: 0, maxFrameMs: 0, medianFrameMs: 0,
        durationMs,
      });
      return;
    }
    const samples = [];
    let last = -1;
    const startWall = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    function step(now) {
      // Keep the slice-752 render-on-demand gate dirty so renderer.render
      // actually runs each rAF tick instead of skipping idle frames.
      if (forceRender) {
        try {
          if (typeof window.__studioInvalidate === 'function') window.__studioInvalidate();
        } catch (_) { /* swallow — perf meter must never throw */ }
      }
      if (last >= 0) {
        const dt = now - last;
        if (dt >= 0 && dt < 10000) samples.push(dt);
      }
      last = now;
      const elapsed = now - startWall;
      if (elapsed < durationMs) {
        requestAnimationFrame(step);
      } else {
        finalize();
      }
    }

    function finalize() {
      if (!samples.length) {
        resolve({
          ok: true,
          fps: 0, frameTimeMs: 0, frameCount: 0,
          minFrameMs: 0, maxFrameMs: 0, medianFrameMs: 0,
          durationMs,
          samples: includeSamples ? [] : undefined,
        });
        return;
      }
      const n = samples.length;
      let sum = 0;
      let minV = Infinity;
      let maxV = -Infinity;
      for (let i = 0; i < n; i++) {
        const v = samples[i];
        sum += v;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
      const mean = sum / n;
      // Median via in-place sort of a copy.
      const sorted = samples.slice().sort((a, b) => a - b);
      const median = (n % 2)
        ? sorted[(n - 1) >> 1]
        : 0.5 * (sorted[(n / 2) - 1] + sorted[n / 2]);
      const fps = mean > 0 ? (1000 / mean) : 0;

      resolve({
        ok: true,
        fps,
        frameTimeMs: mean,
        frameCount: n,
        minFrameMs: minV,
        maxFrameMs: maxV,
        medianFrameMs: median,
        durationMs,
        gpuMs: undefined,
        samples: includeSamples ? samples : undefined,
      });
    }

    requestAnimationFrame(step);
  });
}

export default measureFPS;
