// ArchDisc Studio V3 — Substance Designer noise generators + filters (slice 775).
//
// Headed Mac-Electron spec. Verifies the 12 generator / 8 filter surface
// installed by `v3/sdgen/`.
//
// Flow:
//   • boot the V3 shell
//   • ensure the sdgen autoload has installed __studioSDGen*
//   • __studioSDGenListGenerators() → ≥ 12 names
//   • __studioSDGenListFilters()    → ≥ 8 names
//   • __studioSDGenCreate({generator:'perlin'}) → samples 10×10 in [0, 1]
//     and at least some variance (NOT a flat field)
//   • __studioSDGenApplyFilter({filter:'blur', passes: 4}) → variance
//     strictly decreases vs the source
//   • __studioSDGenExportCanvasTexture() → dataURL begins with
//     'data:image/png;base64,'
//   • 5 named camera angles get captured for remote-desktop watchers.
//
// e2e DOES NOT run during this slice (per the brief); this file just has
// to compile when written.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-sdgen');
const NAMED_VIEWS = ['front', 'top', 'right', 'iso', 'close'];

const REQUIRED_GENERATORS = [
  'perlin', 'simplex', 'voronoi', 'worley',
  'brick', 'tile', 'wave', 'stripe',
  'checker', 'gabor', 'cellular', 'cracks',
];
const REQUIRED_FILTERS = [
  'blur', 'sharpen', 'levels', 'curves',
  'hsv', 'tile', 'mirror', 'warp',
];

function _variance(samples) {
  const flat = [].concat(...samples);
  const mean = flat.reduce((a, b) => a + b, 0) / flat.length;
  let v = 0;
  for (const x of flat) v += (x - mean) * (x - mean);
  return v / flat.length;
}

test('Studio V3 — Substance Designer noise generators + filters (slice 775)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });
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

  // ── Ensure the sdgen autoload has run. ────────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioSDGenCreate !== 'function') {
      await import('/src/workbenches/studio/v3/sdgen/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioSDGenListGenerators === 'function'
       && typeof window.__studioSDGenListFilters === 'function'
       && typeof window.__studioSDGenCreate === 'function'
       && typeof window.__studioSDGenApplyFilter === 'function'
       && typeof window.__studioSDGenExportCanvasTexture === 'function'
       && typeof window.__studioSDGenList === 'function'
       && typeof window.__studioSDGenDelete === 'function',
    null, { timeout: 20000 }
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Generators registered. ────────────────────────────────────
  const gens = await win.evaluate(() => window.__studioSDGenListGenerators());
  expect(gens.ok).toBe(true);
  expect(Array.isArray(gens.names)).toBe(true);
  expect(gens.names.length).toBeGreaterThanOrEqual(12);
  for (const g of REQUIRED_GENERATORS) expect(gens.names).toContain(g);

  // ── 2) Filters registered. ───────────────────────────────────────
  const filts = await win.evaluate(() => window.__studioSDGenListFilters());
  expect(filts.ok).toBe(true);
  expect(Array.isArray(filts.names)).toBe(true);
  expect(filts.names.length).toBeGreaterThanOrEqual(8);
  for (const f of REQUIRED_FILTERS) expect(filts.names).toContain(f);

  // ── 3) Perlin: samples in [0, 1] + some variance. ────────────────
  const perlin = await win.evaluate(() => window.__studioSDGenCreate({
    generator: 'perlin',
    params: { size: 256, scale: 8 },
    seed: 42,
  }));
  expect(perlin.ok).toBe(true);
  expect(typeof perlin.key).toBe('string');
  expect(Array.isArray(perlin.samples)).toBe(true);
  expect(perlin.samples.length).toBe(10);
  for (const row of perlin.samples) {
    expect(row.length).toBe(10);
    for (const v of row) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  }
  const varSrc = _variance(perlin.samples);
  expect(varSrc).toBeGreaterThan(0.001);

  // ── 4) Blur reduces variance. ────────────────────────────────────
  const blurred = await win.evaluate((key) => window.__studioSDGenApplyFilter({
    key, filter: 'blur', params: { passes: 4 },
  }), perlin.key);
  expect(blurred.ok).toBe(true);
  expect(Array.isArray(blurred.samples)).toBe(true);
  const varBlur = _variance(blurred.samples);
  expect(varBlur).toBeLessThan(varSrc);

  // ── 5) Export to CanvasTexture: dataURL begins as a PNG. ─────────
  const exp = await win.evaluate((key) => window.__studioSDGenExportCanvasTexture({
    key, size: 128,
  }), perlin.key);
  expect(exp.ok).toBe(true);
  expect(typeof exp.dataUrl).toBe('string');
  expect(exp.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  expect(exp.size).toBe(128);

  // ── 6) List + Delete round-trip. ─────────────────────────────────
  const before = await win.evaluate(() => window.__studioSDGenList());
  expect(before.ok).toBe(true);
  expect(before.keys).toContain(perlin.key);
  const del = await win.evaluate((key) => window.__studioSDGenDelete({ key }), perlin.key);
  expect(del.ok).toBe(true);
  expect(del.deleted).toBe(true);
  const after = await win.evaluate(() => window.__studioSDGenList());
  expect(after.keys).not.toContain(perlin.key);

  await win.waitForTimeout(180);
  await win.screenshot({ path: path.join(OUT, '01-after-pipeline.png') });

  // ── 7) 5-cam sweep. ──────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 775: generators=%d filters=%d varSrc=%f varBlur=%f',
    gens.names.length, filts.names.length, varSrc, varBlur);

  await app.close();
});
