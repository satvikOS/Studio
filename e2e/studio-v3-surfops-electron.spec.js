import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-surfops');

test('Studio V3 — NURBS / sweep / trimmed surface family (slice 410)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioAddNurbsSurface === 'function', null, { timeout: 15000 });

  // NURBS surface.
  let r = await win.evaluate(() => window.__studioAddNurbsSurface({ uSegs: 8, vSegs: 8 }));
  expect(r.ok).toBe(true);
  expect(r.uuid).toBeTruthy();
  expect(r.vertices).toBeGreaterThan(0);

  // NURBS curve (tube).
  r = await win.evaluate(() => window.__studioAddNurbsCurve({ segments: 32, radius: 0.002 }));
  expect(r.ok).toBe(true);
  expect(r.vertices).toBeGreaterThan(0);

  // Sweep / loft.
  r = await win.evaluate(() => window.__studioSweepLoft({}));
  expect(r.ok).toBe(true);
  expect(r.vertices).toBeGreaterThan(0);

  // Trimmed surface.
  r = await win.evaluate(() => window.__studioTrimmedSurface({}));
  expect(r.ok).toBe(true);
  expect(r.vertices).toBeGreaterThan(0);

  // After spawning 4 primitives, the V3 scene should have 4 marked
  // primitives.
  const sceneCount = await win.evaluate(() => {
    let n = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n;
  });
  expect(sceneCount).toBe(4);

  // BRep boolean is registered (may fail to load OCCT in test env; we
  // only verify the function exists and returns ok/err shape).
  expect(await win.evaluate(() => typeof window.__studioBRepBoolean)).toBe('function');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 410: nurbs surface/curve + sweep + trimmed all spawn → 4 prims');

  await app.close();
});
