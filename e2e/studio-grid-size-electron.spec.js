import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 240: grid-size slider rebuilds the GridHelper.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-grid-size');

test('Studio — grid-size slider resizes the ground grid', async () => {
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
  await win.waitForFunction(() => !!window.__studioGrid, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(300);

  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-npanel-grid-size]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '3');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await win.waitForTimeout(300);
  const size = await win.evaluate(() => window.__studioGridSize);
  expect(size, 'grid size mirror').toBeCloseTo(3, 1);
  await win.screenshot({ path: path.join(OUT, '00-big-grid.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 240: grid size slider working');

  await app.close();
});
