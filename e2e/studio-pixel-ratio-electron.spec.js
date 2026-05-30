import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 255: pixel ratio control.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-pixel-ratio');

test('Studio — N-panel pixel ratio drives renderer.getPixelRatio', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 700,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => typeof window.__studioSetPixelRatio === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  await win.evaluate(() => window.__studioSetPixelRatio(0.5));
  expect(await win.evaluate(() => window.__archdiscViewport.renderer.getPixelRatio())).toBeCloseTo(0.5, 2);
  expect(await win.evaluate(() => window.__studioPixelRatio)).toBeCloseTo(0.5, 2);

  await win.evaluate(() => window.__studioSetPixelRatio(2));
  expect(await win.evaluate(() => window.__archdiscViewport.renderer.getPixelRatio())).toBeCloseTo(2, 2);

  // Clamp test.
  await win.evaluate(() => window.__studioSetPixelRatio(99));
  expect(await win.evaluate(() => window.__studioPixelRatio)).toBe(3);

  // Reset to 1.
  await win.evaluate(() => window.__studioSetPixelRatio(1));
  await win.screenshot({ path: path.join(OUT, '00-back-to-1.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 255: pixel ratio control working');

  await app.close();
});
