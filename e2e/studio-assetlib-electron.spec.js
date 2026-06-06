// ArchDisc Studio V3 — Asset Library catalog (slice 771).
//
// Headed Mac-Electron spec. Verifies the in-memory asset catalog +
// spawn op + tag / category / search surface installed by
// `v3/assetlib/`.
//
// Flow:
//   • boot the V3 shell
//   • ensure the assetlib autoload has installed __studioAssetLib*
//   • __studioAssetLibList()                → ≥50 items
//   • __studioAssetLibTags()                → ≥4 tags incl. 'primitive', 'light', 'camera', 'material'
//   • __studioAssetLibCategories()          → 4 seeded categories
//   • __studioAssetLibSearch({query:'sphere'}) → at least one match
//   • __studioAssetLibSpawn({assetId:'prim-sphere', position:[0,0.05,0]})
//     → scene now carries a Mesh whose name starts with the assetId
//   • 5 named camera angles get captured for remote-desktop watchers.
//
// e2e DOES NOT run during this slice (per the brief); this file just
// has to compile when written.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-assetlib');
const NAMED_VIEWS = ['front', 'top', 'right', 'iso', 'close'];

test('Studio V3 — Asset Library (slice 771)', async () => {
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

  // ── Ensure the assetlib autoload has run. ─────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioAssetLibList !== 'function') {
      await import('/src/workbenches/studio/v3/assetlib/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioAssetLibList === 'function'
       && typeof window.__studioAssetLibSpawn === 'function'
       && typeof window.__studioAssetLibSearch === 'function'
       && typeof window.__studioAssetLibTags === 'function'
       && typeof window.__studioAssetLibCategories === 'function'
       && typeof window.__studioAssetLibAddCustom === 'function',
    null, { timeout: 20000 }
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Full list: catalog has ≥ 50 seeded entries. ───────────────
  const all = await win.evaluate(() => window.__studioAssetLibList());
  expect(all.ok).toBe(true);
  expect(Array.isArray(all.items)).toBe(true);
  expect(all.items.length).toBeGreaterThanOrEqual(50);
  expect(all.total).toBeGreaterThanOrEqual(50);
  // Each item carries the four projection fields.
  for (const it of all.items.slice(0, 5)) {
    expect(typeof it.id).toBe('string');
    expect(typeof it.name).toBe('string');
    expect(typeof it.category).toBe('string');
    expect(Array.isArray(it.tags)).toBe(true);
  }

  // ── 2) Tags: at least the four seed tags appear. ─────────────────
  const tags = await win.evaluate(() => window.__studioAssetLibTags());
  expect(tags.ok).toBe(true);
  expect(tags.tags).toEqual(expect.arrayContaining(['primitive', 'geometry', 'light', 'camera', 'material', 'pbr']));

  // ── 3) Categories: the four seed categories appear. ──────────────
  const cats = await win.evaluate(() => window.__studioAssetLibCategories());
  expect(cats.ok).toBe(true);
  expect(cats.categories).toEqual(expect.arrayContaining(['Primitives', 'Lights', 'Cameras', 'Materials']));

  // ── 4) Search: 'sphere' surfaces the sphere primitive. ───────────
  const search = await win.evaluate(() => window.__studioAssetLibSearch({ query: 'sphere' }));
  expect(search.ok).toBe(true);
  const sphereHit = search.items.find((i) => i.id === 'prim-sphere');
  expect(sphereHit).toBeTruthy();
  expect(sphereHit.name).toBe('Sphere');
  expect(sphereHit.category).toBe('Primitives');

  // ── 5) Filter: list({category:'Lights'}) returns only lights. ────
  const lightsList = await win.evaluate(() => window.__studioAssetLibList({ category: 'Lights' }));
  expect(lightsList.ok).toBe(true);
  expect(lightsList.items.length).toBeGreaterThanOrEqual(10);
  for (const it of lightsList.items) expect(it.category).toBe('Lights');

  // ── 6) Filter by tag: only camera-tagged assets. ─────────────────
  const camsByTag = await win.evaluate(() => window.__studioAssetLibList({ tag: 'camera' }));
  expect(camsByTag.ok).toBe(true);
  expect(camsByTag.items.length).toBeGreaterThanOrEqual(8);
  for (const it of camsByTag.items) expect(it.tags).toContain('camera');

  // ── 7) Spawn the 'sphere' asset; scene gains a Mesh with that uuid. ──
  const spawn = await win.evaluate(() => window.__studioAssetLibSpawn({
    assetId: 'prim-sphere',
    position: [0, 0.05, 0],
  }));
  expect(spawn.ok).toBe(true);
  expect(typeof spawn.uuid).toBe('string');
  expect(spawn.assetId).toBe('prim-sphere');

  const hasMesh = await win.evaluate((uuid) => {
    const scene = window.__archdiscScene;
    if (!scene) return false;
    let found = null;
    scene.traverse((o) => { if (o.uuid === uuid) found = o; });
    return !!(found && found.isMesh);
  }, spawn.uuid);
  expect(hasMesh).toBe(true);
  await win.waitForTimeout(180);
  await win.screenshot({ path: path.join(OUT, '01-sphere-spawned.png') });

  // ── 8) AddCustom: register a user asset; List sees it. ───────────
  const added = await win.evaluate(() => window.__studioAssetLibAddCustom({
    name: 'My Test Cube', category: 'Custom', tags: ['custom', 'demo'],
  }));
  expect(added.ok).toBe(true);
  expect(typeof added.assetId).toBe('string');
  expect(added.category).toBe('Custom');
  const after = await win.evaluate(() => window.__studioAssetLibList());
  expect(after.items.length).toBe(all.items.length + 1);
  const customCats = await win.evaluate(() => window.__studioAssetLibCategories());
  expect(customCats.categories).toContain('Custom');

  // ── 9) Spawn the custom asset to prove it spawns through the same path. ──
  const customSpawn = await win.evaluate((id) => window.__studioAssetLibSpawn({
    assetId: id, position: [0.05, 0.05, 0],
  }), added.assetId);
  expect(customSpawn.ok).toBe(true);
  expect(typeof customSpawn.uuid).toBe('string');
  await win.waitForTimeout(180);

  // ── 10) 5-cam sweep. ─────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 771: catalog size', all.items.length,
    'tags', tags.tags.length, 'categories', cats.categories.length,
    'spawned uuid', spawn.uuid, 'custom uuid', customSpawn.uuid);

  await app.close();
});
