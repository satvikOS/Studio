import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-ribbon-brand');

test('Studio — ribbon restyled to Studio brand (slice 339)', async () => {
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
  await win.waitForTimeout(800);

  // Ribbon container = #0d1117.
  const ribbonBg = await win.evaluate(() => {
    const el = document.querySelector('.ribbon-container');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  expect(ribbonBg).toContain('rgb(13, 17, 23)');

  // Ribbon content panel = #161b22.
  const contentBg = await win.evaluate(() => {
    const el = document.querySelector('.ribbon-content');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  expect(contentBg).toContain('rgb(22, 27, 34)');

  // Active ribbon tab border = teal.
  const tabBorder = await win.evaluate(() => {
    const el = document.querySelector('.ribbon-tab.active, .ribbon-tab[data-studio-active="1"]');
    return el ? getComputedStyle(el).borderBottomColor : null;
  });
  expect(tabBorder).toContain('rgb(29, 233, 182)');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 339: ribbon container + content + active tab on Studio palette');

  await app.close();
});
