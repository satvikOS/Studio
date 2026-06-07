// ArchDisc Studio V3 — Houdini POPs (Particle Operators) headed
// Mac-Electron spec (slice 777).
//
// Boots the V3 shell, installs the popfx autoload, creates a 100-particle
// POPSolver with gravity + wind, steps 60 frames at dt=0.016 (~1.0s
// simulated), and verifies:
//   • the solver exposes a real handle (string `key`) + reports
//     count: 100 alongside its lifeMin/lifeMax
//   • after 60 steps the sampled particle positions have moved off their
//     initial spawn coordinates — gravity dragged them down (mean Y
//     drops below the spawn Y) and wind pushed them along its direction
//     (mean X grows positive)
//   • adding more forces via `__studioPopAddForce` increments forceCount
//   • `__studioPopList` enumerates the solver and reports the canonical
//     force-kind list
//   • `__studioPopRemove` drops the handle
//   • 5 named camera angles get captured for remote-desktop watchers
//
// e2e DOES NOT run during this slice (per the brief — the harness runs
// builds, not playwright). This file just has to compile when written.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-popfx');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — Houdini POPs (Particle Operators) (slice 777)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });
  // --dev may auto-open a DevTools window; pick the real app window.
  let win = null;
  for (let i = 0; i < 30 && !win; i++) {
    win = app.windows().find((w) => {
      const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
      return u && !u.startsWith('devtools://');
    }) || null;
    if (!win) { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!win) win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  let shellUp = false;
  for (let attempt = 0; attempt < 4 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1500);
    try {
      await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 40000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 30000 });

  // ── Ensure the popfx module is installed. ─────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioPopCreate !== 'function') {
      await import('/src/workbenches/studio/v3/popfx/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioPopCreate === 'function'
       && typeof window.__studioPopStep === 'function'
       && typeof window.__studioPopAddForce === 'function'
       && typeof window.__studioPopList === 'function'
       && typeof window.__studioPopRemove === 'function',
    null, { timeout: 20000 }
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Create a 100-particle POP solver with gravity + wind. ──────
  // Box emitter at origin (spread ±0.5 along each axis) so the initial
  // population has measurable variance; life = 5s so nothing dies during
  // the 60-frame window; continuous = false so we see 100 distinct
  // particles fall + drift WITHOUT mid-simulation respawns muddling the
  // captured position deltas; ground plane disabled so gravity doesn't
  // hit a floor inside the window.
  const create = await win.evaluate(() => {
    return window.__studioPopCreate({
      count: 100,
      emitter: { shape: 'box', center: [0, 0, 0], sizeX: 1, sizeY: 1, sizeZ: 1 },
      life: 5.0,
      forces: [
        { kind: 'gravity', params: { g: 9.81 } },
        { kind: 'wind',    params: { direction: [1, 0, 0], strength: 2.0 } },
      ],
      collision: null,
      continuous: false,
      seed: 777,
    });
  });
  console.log('[popfx] create', JSON.stringify(create));
  expect(create.ok).toBe(true);
  expect(typeof create.key).toBe('string');
  expect(create.count).toBe(100);
  expect(create.lifeMin).toBeCloseTo(5.0, 5);
  expect(create.lifeMax).toBeCloseTo(5.0, 5);
  expect(create.forceCount).toBe(2);

  // ── 2) Snapshot the spawn positions before any step runs. ─────────
  // sampleN=20 so we get a wider sample to average. Pre-step the list to
  // populate `aliveCount` first (the prefill happens at construction).
  const initial = await win.evaluate((key) => {
    const r = window.__studioPopStep({ key, dt: 0.0, sampleN: 20 });
    return r;
  }, create.key);
  expect(initial.ok).toBe(true);
  expect(initial.aliveCount).toBe(100);
  expect(Array.isArray(initial.samplePositions)).toBe(true);
  expect(initial.samplePositions.length).toBe(20);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-pop-created.png') });

  const initMeanY = initial.samplePositions.reduce((a, p) => a + p[1], 0)
                    / initial.samplePositions.length;
  const initMeanX = initial.samplePositions.reduce((a, p) => a + p[0], 0)
                    / initial.samplePositions.length;
  // Initial positions are uniform in [-0.5, 0.5] along each axis, mean
  // should be near 0 to within sampling noise (20 samples; tolerate ±0.5).
  expect(Math.abs(initMeanY)).toBeLessThan(0.5);
  expect(Math.abs(initMeanX)).toBeLessThan(0.5);
  console.log('[popfx] initMeanX=%f initMeanY=%f', initMeanX, initMeanY);

  // ── 3) Step 60 frames at dt=0.016 (~0.96s simulated). ─────────────
  // After 60 frames: with gravity = -9.81 m/s² and the dt=0 initial
  // step adding no velocity, after 60 substeps the *velocity* integral
  // is roughly -9.81 · 0.016 · 60 = -9.42 m/s; the *position* drop
  // (Euler) is sum_{k=1..60} (-9.81 · 0.016 · k) · 0.016 ≈ -4.6 m.
  // Wind contribution along +X is (2.0 m/s²) integrated similarly so
  // mean X grows to ~+0.94 m.
  const stepped = await win.evaluate((key) => {
    let last = null;
    for (let f = 0; f < 60; f++) {
      last = window.__studioPopStep({ key, dt: 0.016, sampleN: 20 });
      if (!last || !last.ok) return { error: 'step failed at f=' + f, last };
    }
    return last;
  }, create.key);
  expect(stepped.ok).toBe(true);
  expect(stepped.aliveCount).toBe(100);
  expect(stepped.samplePositions.length).toBe(20);

  const finalMeanY = stepped.samplePositions.reduce((a, p) => a + p[1], 0)
                     / stepped.samplePositions.length;
  const finalMeanX = stepped.samplePositions.reduce((a, p) => a + p[0], 0)
                     / stepped.samplePositions.length;
  console.log('[popfx] finalMeanX=%f finalMeanY=%f elapsed=%f',
              finalMeanX, finalMeanY, stepped.elapsed);

  // Particles must have moved measurably.
  expect(finalMeanY).toBeLessThan(initMeanY - 1.0);   // gravity dragged them down
  expect(finalMeanX).toBeGreaterThan(initMeanX + 0.3); // wind pushed them right
  // Elapsed bookkeeping.
  expect(stepped.elapsed).toBeGreaterThan(0.9);
  expect(stepped.elapsed).toBeLessThan(1.1);

  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-after-60-steps.png') });

  // ── 4) Adding a force surfaces forceCount. ────────────────────────
  const addF = await win.evaluate((key) => {
    return window.__studioPopAddForce({
      key,
      kind: 'turbulence',
      params: { scale: 0.5, strength: 1.0 },
    });
  }, create.key);
  expect(addF.ok).toBe(true);
  expect(addF.forceCount).toBe(3);

  // ── 5) List enumerates the solver + reports canonical force kinds. ─
  const listing = await win.evaluate(() => window.__studioPopList());
  expect(listing.ok).toBe(true);
  expect(Array.isArray(listing.items)).toBe(true);
  const me = listing.items.find((it) => it.key === create.key);
  expect(me).toBeTruthy();
  expect(me.count).toBe(100);
  expect(me.forceCount).toBe(3);
  expect(me.aliveCount).toBe(100);
  expect(Array.isArray(listing.forceKinds)).toBe(true);
  expect(listing.forceKinds).toEqual(['gravity', 'wind', 'turbulence', 'curl', 'vortex', 'attractor']);

  // ── 6) Camera sweep — 5 named angles. ─────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport;
      const c = vp && vp.camera;
      if (c) {
        if (v === 'front') c.position.set(0, 0.5, 5);
        else if (v === 'top') c.position.set(0, 5, 0.001);
        else if (v === 'right') c.position.set(5, 0.5, 0);
        else if (v === 'iso') c.position.set(3, 3, 3);
        else if (v === 'close') c.position.set(1.5, 1.5, 1.5);
        c.lookAt(0, 0.5, 0);
      } else if (typeof window.__studioSetView === 'function') {
        window.__studioSetView(v);
      } else if (typeof window.__archdiscSetView === 'function') {
        window.__archdiscSetView(v);
      }
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // ── 7) Remove sanity. ─────────────────────────────────────────────
  const rm = await win.evaluate((key) => window.__studioPopRemove({ key }), create.key);
  expect(rm.ok).toBe(true);
  const listingAfter = await win.evaluate(() => window.__studioPopList());
  expect(listingAfter.items.some((it) => it.key === create.key)).toBe(false);

  // eslint-disable-next-line no-console
  console.log('  slice 777: initMeanY=%f → finalMeanY=%f; initMeanX=%f → finalMeanX=%f',
    initMeanY, finalMeanY, initMeanX, finalMeanX);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
