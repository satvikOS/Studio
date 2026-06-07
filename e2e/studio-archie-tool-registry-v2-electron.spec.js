// ArchDisc Studio — Archie Tool Registry V2 (slice 787).
//
// Headed Mac-Electron spec. Verifies the auto-introspected Archie tool
// registry installed by `frontend/src/ai/index-installer.js` (wired
// into `v3/api.js` after every parity-module autoload chain).
//
// Flow:
//   • boot the V3 shell
//   • ensure `installToolRegistryV2()` has run (window.__archieToolList
//     etc. are present)
//   • __archieToolList()           → ≥ 300 tools, each carrying name +
//                                    category + description + paramSpec
//   • __archieGetCategories()      → includes sculpt, fx, rig, anim,
//                                    mograph, volume, texpaint
//   • __archieGetTool(name)        → returns the live entry for a
//                                    representative slice-777 op
//                                    (__studioPopCreate) with a callable
//                                    fn handle
//   • __archieToolCounts()         → per-category integer counts
//   • __archieToolManifest()       → JSON-serialisable shape with
//                                    builtAt + total + categories
//   • 5 named camera angles get captured for remote-desktop watchers
//
// e2e DOES NOT run during this slice (per the brief — the harness
// runs builds, not playwright). This file just has to compile when
// written.
//
// The required brief check is `≥ 300 tools` and the category presence
// list `{ sculpt, fx, rig, anim, mograph, volume, texpaint }`.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-archie-tool-registry-v2');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

// The brief calls these out explicitly — registry must surface them.
const REQUIRED_CATEGORIES = [
  'sculpt', 'fx', 'rig', 'anim', 'mograph', 'volume', 'texpaint',
];

test('Studio V3 — Archie Tool Registry V2 (slice 787)', async () => {
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

  // ── Ensure the installer has run. ────────────────────────────────
  // The api.js boot path lazy-imports index-installer.js AFTER every
  // parity-module autoload chain; fall back to an explicit dynamic
  // import if the test boots before that microtask fires.
  await win.evaluate(async () => {
    if (typeof window.__archieToolList !== 'function') {
      await import('/src/ai/index-installer.js');
    }
  });
  // Also nudge every parity module so the registry has time to populate.
  await win.waitForFunction(
    () => typeof window.__archieToolList === 'function'
       && typeof window.__archieGetTool === 'function'
       && typeof window.__archieGetCategories === 'function'
       && typeof window.__archieToolCounts === 'function'
       && typeof window.__archieToolManifest === 'function',
    null, { timeout: 20000 }
  );
  // Give the autoload chain a chance to flush every registerOps call.
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) __archieToolList() → ≥ 300 tools. ─────────────────────────
  const tools = await win.evaluate(() => window.__archieToolList());
  expect(Array.isArray(tools)).toBe(true);
  console.log('[tool-registry-v2] tool count =', tools.length);
  expect(tools.length).toBeGreaterThanOrEqual(300);
  // Each entry carries the contract shape.
  for (const t of tools.slice(0, 10)) {
    expect(typeof t.name).toBe('string');
    expect(t.name.startsWith('__studio')).toBe(true);
    expect(typeof t.category).toBe('string');
    expect(typeof t.description).toBe('string');
    expect(typeof t.paramSpec).toBe('object');
  }

  // ── 2) __archieGetCategories() → required categories present. ────
  const cats = await win.evaluate(() => window.__archieGetCategories());
  expect(Array.isArray(cats)).toBe(true);
  console.log('[tool-registry-v2] categories =', cats.join(','));
  for (const required of REQUIRED_CATEGORIES) {
    expect(cats).toContain(required);
  }

  // ── 3) __archieGetTool(name) → live entry for a known op. ────────
  // __studioPopCreate registers under category 'fx' (slice 777).
  const popTool = await win.evaluate(() => window.__archieGetTool('__studioPopCreate'));
  expect(popTool).toBeTruthy();
  expect(popTool.name).toBe('__studioPopCreate');
  expect(popTool.category).toBe('fx');
  expect(typeof popTool.description).toBe('string');
  // The live `fn` field must reference the registered action. We can't
  // serialise a function across the worker boundary, but we can ask the
  // browser to confirm typeof.
  const fnType = await win.evaluate(() => typeof window.__archieGetTool('__studioPopCreate')?.fn);
  expect(fnType).toBe('function');

  // Unknown name → null.
  const missing = await win.evaluate(() => window.__archieGetTool('__studioDoesNotExist'));
  expect(missing).toBeNull();

  // ── 4) __archieToolCounts() per-category integer counts. ─────────
  const counts = await win.evaluate(() => window.__archieToolCounts());
  expect(typeof counts).toBe('object');
  // Sum of counts equals tool count.
  let sum = 0;
  for (const k of Object.keys(counts)) {
    expect(typeof counts[k]).toBe('number');
    sum += counts[k];
  }
  expect(sum).toBe(tools.length);
  for (const required of REQUIRED_CATEGORIES) {
    expect(counts[required]).toBeGreaterThan(0);
  }

  // ── 5) __archieToolManifest() — JSON-serialisable shape. ─────────
  const manifest = await win.evaluate(() => window.__archieToolManifest());
  expect(typeof manifest).toBe('object');
  expect(typeof manifest.builtAt).toBe('number');
  expect(typeof manifest.total).toBe('number');
  expect(manifest.total).toBe(tools.length);
  expect(typeof manifest.categories).toBe('object');
  for (const required of REQUIRED_CATEGORIES) {
    expect(manifest.categories[required]).toBeTruthy();
    expect(manifest.categories[required].count).toBeGreaterThan(0);
    expect(Array.isArray(manifest.categories[required].tools)).toBe(true);
    // Entries carry paramTypes (not paramSpec — the manifest shape).
    const sample = manifest.categories[required].tools[0];
    expect(typeof sample.name).toBe('string');
    expect(typeof sample.category).toBe('string');
    expect(typeof sample.description).toBe('string');
    expect(typeof sample.paramTypes).toBe('object');
  }
  // The manifest is JSON-safe: a round-trip preserves the count.
  const roundtrip = await win.evaluate(() => {
    const m = window.__archieToolManifest();
    return JSON.parse(JSON.stringify(m));
  });
  expect(roundtrip.total).toBe(manifest.total);

  // ── 6) Camera sweep — 5 named angles. ────────────────────────────
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

  // eslint-disable-next-line no-console
  console.log('  slice 787: total=%d categories=%d sculpt=%d fx=%d rig=%d anim=%d mograph=%d volume=%d texpaint=%d',
    tools.length, cats.length, counts.sculpt, counts.fx, counts.rig,
    counts.anim, counts.mograph, counts.volume, counts.texpaint);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
