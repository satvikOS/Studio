import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 24 — Showreel: one-click 4-view auto-capture (front / right /
 * back / left) of the current scene.
 *
 * Click Capture 4-View Showreel → camera orbits through each angle
 * with a settle pause and Render Frame fires per-angle, appending
 * four thumbnails to the Renders panel.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-showreel');

test('Studio showreel — one click captures 4 distinct turntable views', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 300,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- Compose a small scene so the showreel has something to frame ----
  for (const k of ['cube', 'torus-knot', 'cone']) {
    await win.locator(`[data-studio-primitive="${k}"]`).click();
    await win.waitForTimeout(250);
  }
  await expect(win.locator('[data-studio-render-count]')).toHaveText('0');
  await win.screenshot({ path: path.join(OUT, '00-scene-pre-showreel.png'), fullPage: false });

  // ---- Capture Showreel — 4 renders added ----
  await win.locator('[data-studio-action="capture-showreel"]').click();
  await expect
    .poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()),
          { timeout: 8000, message: 'showreel did not produce 4 thumbnails' })
    .toBe(4);

  // Confirm each of the 4 thumbnails carries a non-trivial data URL.
  const dataLens = await win.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('[data-studio-render-image]'));
    return imgs.map(el => (el.getAttribute('src') || '').length);
  });
  expect(dataLens.length).toBe(4);
  for (const len of dataLens) expect(len).toBeGreaterThan(1000);
  // The four captures came from different orbits, so consecutive thumbs
  // should not share the same data URL.
  const distinct = new Set(await win.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-studio-render-image]'))
      .map(el => el.getAttribute('src'));
  })).size;
  expect(distinct).toBe(4);
  await win.screenshot({ path: path.join(OUT, '01-after-showreel.png'), fullPage: false });

  // Second showreel — count grows by 4 again, total 8 thumbnails.
  await win.locator('[data-studio-action="capture-showreel"]').click();
  await expect
    .poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()),
          { timeout: 8000 })
    .toBe(8);
  await win.screenshot({ path: path.join(OUT, '02-two-showreels-8-thumbs.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log('  showreel: scene → 1 click = 4 turntable thumbs; 2 clicks = 8 thumbs (all distinct)');

  await app.close();
});
