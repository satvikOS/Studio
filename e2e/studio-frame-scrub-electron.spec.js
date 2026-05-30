import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 247: N-panel View tab frame scrubber.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-frame-scrub');

test('Studio — N-panel frame scrubber drives currentFrame', async () => {
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
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(300);

  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-npanel-frame-scrub]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '42');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await win.waitForTimeout(300);
  expect(await win.evaluate(() => window.__studioGetFrame())).toBe(42);
  await expect(win.locator('[data-studio-npanel-frame]')).toHaveText('42');
  await win.screenshot({ path: path.join(OUT, '00-scrubbed.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 247: frame scrubber working');

  await app.close();
});
