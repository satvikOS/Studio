import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-scene-meta');

test('Studio V3 — scene meta: units/get/scale/getMeta/setMeta/convert (slice 659)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
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
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // 1: set units cm
  const u = await win.evaluate(() => window.__studioSetSceneUnits('cm'));
  expect(u.ok).toBe(true);
  expect(u.units).toBe('cm');
  expect(u.factor).toBe(0.01);
  await win.screenshot({ path: path.join(OUT, '01-units.png') });

  // 2: get units
  const g = await win.evaluate(() => window.__studioGetSceneUnits());
  expect(g.units).toBe('cm');
  await win.screenshot({ path: path.join(OUT, '02-getUnits.png') });

  // 3: set scale
  const sc = await win.evaluate(() => window.__studioSetSceneScale(2.5));
  expect(sc.scale).toBe(2.5);
  await win.screenshot({ path: path.join(OUT, '03-scale.png') });

  // 4: get metadata
  const md = await win.evaluate(() => window.__studioGetSceneMetadata());
  expect(md.meta.units).toBe('cm');
  expect(md.meta.scale).toBe(2.5);
  expect(md.meta.createdAt).toBeTruthy();
  await win.screenshot({ path: path.join(OUT, '04-getMeta.png') });

  // 5: set metadata (existing field + custom)
  await win.evaluate(() => window.__studioSetSceneMetadata('author', 'satvik'));
  await win.evaluate(() => window.__studioSetSceneMetadata('projectId', 'arch-2026'));
  const md2 = await win.evaluate(() => window.__studioGetSceneMetadata());
  expect(md2.meta.author).toBe('satvik');
  expect(md2.meta.custom.projectId).toBe('arch-2026');
  await win.screenshot({ path: path.join(OUT, '05-setMeta.png') });

  // 6: convert 100 (in cm units, scale 2.5) → meters
  const cv = await win.evaluate(() => window.__studioConvertToMeters(100));
  expect(cv.meters).toBeCloseTo(100 * 0.01 * 2.5, 6);
  await win.screenshot({ path: path.join(OUT, '06-convert.png') });

  // metadata persisted to scene.userData
  const inScene = await win.evaluate(() => window.__archdiscScene?.userData?.archdiscStudioMeta);
  expect(inScene.units).toBe('cm');
  expect(inScene.scale).toBe(2.5);

  // eslint-disable-next-line no-console
  console.log('  slice 659: 6 scene-meta features verified — 100 cm × 2.5 =', cv.meters, 'm');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
