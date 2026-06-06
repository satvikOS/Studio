// ArchDisc Studio V3 — Pyro / gas simulation e2e (slice 730).
//
// Headed Mac-Electron spec (per the user's headed-tests rule; the user
// watches the spec play out remotely).
//
// Exercises the __studioPyro* op surface defined by volume/pyro.js +
// volume/index.js — a Stam stable-fluids gas solver (Houdini Pyro FX,
// Blender Mantaflow smoke, FumeFX, EmberGen):
//   • create a volume + init the float simulation fields
//   • register a bottom-centre emitter (smoke source + heat + updraft)
//   • step the solver and confirm density appears + a velocity field
//     develops + temperature is injected
//   • step further and confirm the plume RISES (density centre-of-mass
//     climbs above the emitter) — proves buoyancy + advection are real
//   • confirm the volume's Data3DTexture is written back (proxy renders)
//   • tune a solver parameter (vorticity) and confirm it takes
//   • reset clears the fields
//   • confirm the command palette (global search) surfaces the ops
//   • sweep named camera angles for remote-desktop verification

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-pyro');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — Houdini Pyro / Mantaflow gas simulation', async () => {
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

  // Install the volume module via autoload (api.js may not have wired it).
  await win.evaluate(async () => {
    if (typeof window.__studioPyroInit !== 'function') {
      await import('/src/workbenches/studio/v3/volume/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioPyroInit === 'function',
    null, { timeout: 20000 });

  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Create a volume + init the simulation. ──────────────────────
  const created = await win.evaluate(() => window.__studioVolumeCreate(48, 48, 48, 0.05));
  expect(created.ok).toBe(true);
  expect(created.sx).toBe(48);

  const init = await win.evaluate(() => window.__studioPyroInit());
  expect(init.ok).toBe(true);
  expect(init.cells).toBe(48 * 48 * 48);

  // ── 2) Register a bottom-centre emitter (smoke + heat + updraft). ──
  const emit = await win.evaluate(() =>
    window.__studioPyroAddEmitter(24, 7, 24, 7, 5.0, 1.0, 9.0));
  expect(emit.ok).toBe(true);
  expect(emit.count).toBe(1);
  expect(emit.emitter.temperature).toBeCloseTo(1.0, 5);

  // ── 3) Step the solver a few frames; density + velocity must appear. ──
  let stats = null;
  for (let i = 0; i < 12; i++) {
    stats = await win.evaluate(() => window.__studioPyroStep(0.1, 1));
  }
  expect(stats.ok).toBe(true);
  expect(stats.frame).toBe(12);
  expect(stats.totalDensity).toBeGreaterThan(0);
  expect(stats.activeCells).toBeGreaterThan(0);
  expect(stats.maxTemperature).toBeGreaterThan(0);
  expect(stats.maxSpeed).toBeGreaterThan(0); // velocity field developed
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-early-plume.png') });

  // Density centre-of-mass Y, computed straight from the volume's
  // Data3DTexture R channel (density). Sampled now (early) and again after
  // more steps — it must climb, proving buoyancy + advection lift the smoke.
  const comFn = () => {
    let mesh = null;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'volume') mesh = o;
    });
    const tex = mesh && mesh.material?.uniforms?.uVolume?.value;
    if (!tex || !tex.image || !tex.image.data) return -1;
    const d = tex.image.data;
    const sx = tex.image.width, sy = tex.image.height, sz = tex.image.depth;
    let sumY = 0, sumW = 0;
    for (let z = 0; z < sz; z++)
      for (let y = 0; y < sy; y++)
        for (let x = 0; x < sx; x++) {
          const dens = d[(x + y * sx + z * sx * sy) * 4] / 255;
          if (dens > 0.02) { sumY += y * dens; sumW += dens; }
        }
    return sumW > 0 ? sumY / sumW : -1;
  };
  const comEarly = await win.evaluate(comFn);
  expect(comEarly).toBeGreaterThan(0);

  // ── 4) Keep stepping; the plume must RISE (buoyancy + advection). ──
  for (let i = 0; i < 30; i++) {
    stats = await win.evaluate(() => window.__studioPyroStep(0.1, 1));
  }
  expect(stats.frame).toBe(42);

  const comLate = await win.evaluate(comFn);
  expect(comLate).toBeGreaterThan(0);
  // The smoke column lifted: late centre-of-mass is above the early one
  // (emitter sits at y=7; the plume climbs above it).
  expect(comLate).toBeGreaterThan(comEarly);
  expect(stats.totalDensity).toBeGreaterThan(0);
  expect(stats.activeCells).toBeGreaterThan(0);

  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-risen-plume.png') });

  // ── 5) Confirm the volume texture is written back (proxy renders). ──
  const texDirty = await win.evaluate(() => {
    let found = null;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'volume') found = o;
    });
    if (!found) return { ok: false };
    const tex = found.material?.uniforms?.uVolume?.value;
    // Sum the R channel (density) across the buffer — must be > 0 after sim.
    let sum = 0;
    if (tex && tex.image && tex.image.data) {
      const d = tex.image.data;
      for (let i = 0; i < d.length; i += 4) sum += d[i];
    }
    return { ok: true, densitySum: sum, hasMesh: true };
  });
  expect(texDirty.ok).toBe(true);
  expect(texDirty.hasMesh).toBe(true);
  expect(texDirty.densitySum).toBeGreaterThan(0);

  // ── 6) Tune a solver parameter and confirm it takes. ───────────────
  const param = await win.evaluate(() => window.__studioPyroSetParam('vorticity', 8.0));
  expect(param.ok).toBe(true);
  expect(param.value).toBeCloseTo(8.0, 5);

  // ── 7) Reset clears the fields. ────────────────────────────────────
  const reset = await win.evaluate(() => window.__studioPyroReset());
  expect(reset.ok).toBe(true);
  const afterReset = await win.evaluate(() => window.__studioPyroStats());
  expect(afterReset.ok).toBe(true);
  expect(afterReset.stats.totalDensity).toBe(0);
  expect(afterReset.stats.frame).toBe(0);

  // ── 8) One-shot "Ignite" convenience builds a visible plume. ───────
  const ignite = await win.evaluate(() => window.__studioPyroIgnite(35));
  expect(ignite.ok).toBe(true);
  expect(ignite.frames).toBe(35);
  expect(ignite.stats.totalDensity).toBeGreaterThan(0);
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '03-ignite.png') });

  // ── 9) Global search (command palette) surfaces the Pyro ops. ──────
  const search = await win.evaluate(() => window.__studioCommandSearch('pyro', 40));
  expect(search.ok).toBe(true);
  expect(search.count).toBeGreaterThan(0);
  const names = search.hits.map((h) => h.name);
  expect(names).toContain('__studioPyroStep');
  expect(names).toContain('__studioPyroIgnite');
  // "smoke" / "gas" match via the category description.
  const searchSmoke = await win.evaluate(() => window.__studioCommandSearch('gas', 40));
  expect(searchSmoke.count).toBeGreaterThan(0);

  // ── 10) Sweep named camera angles for remote-desktop verification. ──
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(250);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 730: pyro sim frames=', stats.frame,
    'ignite totalDensity=', ignite.stats.totalDensity.toFixed(1));

  await app.close();
});
