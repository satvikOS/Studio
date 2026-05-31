import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-mode-dropdown-brand');

test('Studio — viewport mode dropdown on Studio brand (slice 348)', async () => {
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

  // Mode button closed has #161b22 bg.
  const closedBg = await win.evaluate(() => {
    const el = document.querySelector('[data-studio-viewport-mode]');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  expect(closedBg).toContain('rgb(22, 27, 34)');

  // Open dropdown.
  await win.locator('[data-studio-viewport-mode]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-viewport-mode-dropdown]')).toBeVisible();

  // Open button now teal.
  const openBg = await win.evaluate(() => {
    const el = document.querySelector('[data-studio-viewport-mode]');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  expect(openBg).toContain('rgb(29, 233, 182)');

  // Active option (Object Mode) has teal background.
  const optBg = await win.evaluate(() => {
    const el = document.querySelector('[data-studio-viewport-mode-option-active="1"]');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  expect(optBg).toContain('rgb(29, 233, 182)');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 348: mode dropdown on Studio palette with teal active');

  await app.close();
});
