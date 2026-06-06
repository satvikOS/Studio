// ArchDisc Studio V3 — Pyro combustion / fire e2e (slice 731).
//
// Headed Mac-Electron spec. Builds on the slice-730 gas solver by adding
// a fuel field + combustion model (Houdini Pyro combustion, Blender
// Mantaflow fire, FumeFX fuel): fuel ignites above the ignition
// temperature, releasing heat (fire) + soot (smoke) + a volumetric
// expansion, and is consumed.
//
// Exercises __studioPyroAddFuelEmitter / __studioPyroCampfire:
//   • create + init a volume
//   • register a PILOT-LIT fuel jet (no smoke/heat emitter at all)
//   • step → confirm combustion self-ignites: burningCells > 0, the
//     flame field is non-zero, the fire is hotter than the ignition
//     temperature, and combustion PRODUCES smoke density from nothing
//     but fuel (density rises with zero density-emitters)
//   • confirm the flame intensity is written to the volume texture B
//     channel (fire shading data)
//   • one-shot __studioPyroCampfire builds a sustained flame
//   • global search surfaces the combustion ops
//   • sweep named camera angles for remote-desktop verification

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-pyro-fire');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — Houdini Pyro combustion / Mantaflow fire', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 160,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 20000 });

  await win.evaluate(async () => {
    if (typeof window.__studioPyroAddFuelEmitter !== 'function') {
      await import('/src/workbenches/studio/v3/volume/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioPyroAddFuelEmitter === 'function',
    null, { timeout: 20000 });

  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Create + init a volume. ─────────────────────────────────────
  const created = await win.evaluate(() => window.__studioVolumeCreate(48, 48, 48, 0.05));
  expect(created.ok).toBe(true);
  const init = await win.evaluate(() => window.__studioPyroInit());
  expect(init.ok).toBe(true);

  // ── 2) Register a PILOT-LIT fuel jet — NO smoke/heat emitter. ──────
  const fuel = await win.evaluate(() =>
    window.__studioPyroAddFuelEmitter(24, 8, 24, 6, 7.0, 7.0, true));
  expect(fuel.ok).toBe(true);
  expect(fuel.count).toBe(1);
  expect(fuel.emitter.pilot).toBe(true);

  // ── 3) Step → combustion must self-ignite and sustain. ─────────────
  let stats = null;
  for (let i = 0; i < 30; i++) {
    stats = await win.evaluate(() => window.__studioPyroStep(0.1, 1));
  }
  expect(stats.ok).toBe(true);
  expect(stats.frame).toBe(30);
  // Combustion self-ignited from a pilot light:
  expect(stats.burningCells).toBeGreaterThan(0);
  expect(stats.maxFlame).toBeGreaterThan(0);
  // Fire is hotter than the ignition threshold (default 0.18).
  expect(stats.maxTemperature).toBeGreaterThan(0.18);
  // Smoke density was produced ENTIRELY by combustion (no density emitter).
  expect(stats.totalDensity).toBeGreaterThan(0);
  // The fuel jet is still feeding.
  expect(stats.totalFuel).toBeGreaterThan(0);
  expect(stats.fuelEmitters).toBe(1);
  expect(stats.emitters).toBe(0); // confirms zero smoke/heat emitters

  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-fire.png') });

  // ── 4) Flame intensity is written to the volume texture B channel. ──
  const tex = await win.evaluate(() => {
    let mesh = null;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'volume') mesh = o;
    });
    const t = mesh && mesh.material?.uniforms?.uVolume?.value;
    if (!t || !t.image || !t.image.data) return { ok: false };
    const d = t.image.data;
    let flameSum = 0, densSum = 0;
    for (let i = 0; i < d.length; i += 4) { densSum += d[i]; flameSum += d[i + 2]; }
    return { ok: true, flameSum, densSum };
  });
  expect(tex.ok).toBe(true);
  expect(tex.densSum).toBeGreaterThan(0);  // smoke in R channel
  expect(tex.flameSum).toBeGreaterThan(0); // flame in B channel (fire shading)

  // ── 5) Tune combustion params and confirm they take. ───────────────
  const p1 = await win.evaluate(() => window.__studioPyroSetParam('burnRate', 3.0));
  expect(p1.ok).toBe(true);
  expect(p1.value).toBeCloseTo(3.0, 5);
  const p2 = await win.evaluate(() => window.__studioPyroSetParam('ignitionTemp', 0.25));
  expect(p2.ok).toBe(true);
  expect(p2.value).toBeCloseTo(0.25, 5);

  // ── 6) Reset clears fuel + flame. ──────────────────────────────────
  await win.evaluate(() => window.__studioPyroReset());
  const afterReset = await win.evaluate(() => window.__studioPyroStats());
  expect(afterReset.stats.totalFuel).toBe(0);
  expect(afterReset.stats.burningCells).toBe(0);
  expect(afterReset.stats.totalDensity).toBe(0);

  // ── 7) One-shot Campfire convenience builds a sustained flame. ─────
  const camp = await win.evaluate(() => window.__studioPyroCampfire(40));
  expect(camp.ok).toBe(true);
  expect(camp.frames).toBe(40);
  expect(camp.stats.burningCells).toBeGreaterThan(0);
  expect(camp.stats.maxTemperature).toBeGreaterThan(0.18);
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '02-campfire.png') });

  // ── 8) Global search surfaces the combustion ops. ──────────────────
  const search = await win.evaluate(() => window.__studioCommandSearch('fuel', 40));
  expect(search.ok).toBe(true);
  const names = search.hits.map((h) => h.name);
  expect(names).toContain('__studioPyroAddFuelEmitter');
  const campSearch = await win.evaluate(() => window.__studioCommandSearch('campfire', 40));
  expect(campSearch.hits.map((h) => h.name)).toContain('__studioPyroCampfire');

  // ── 9) Sweep named camera angles for remote-desktop verification. ──
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(250);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 731: combustion burningCells=', stats.burningCells,
    'maxTemp=', stats.maxTemperature.toFixed(2),
    'campfire burningCells=', camp.stats.burningCells);

  await app.close();
});
