import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-brand-chrome');

test('Studio — Studio-brand palette across header + status bar (slice 336)', async () => {
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

  // Top header menubar uses Studio palette (background ≈ #0d1117).
  const headerBg = await win.evaluate(() => {
    const el = document.querySelector('[data-studio-header-menubar]');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  // Browser normalises #0d1117 to rgb(13, 17, 23).
  expect(headerBg).toContain('rgb(13, 17, 23)');

  // Status bar matches.
  const statusBg = await win.evaluate(() => {
    const el = document.querySelector('[data-studio-viewport-status-bar]');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  expect(statusBg).toContain('rgb(13, 17, 23)');

  // Open the Add header menu and inspect active-state colour (teal).
  await win.locator('[data-studio-header-menu-btn="add"]').click();
  await win.waitForTimeout(200);
  const activeBg = await win.evaluate(() => {
    const el = document.querySelector('[data-studio-header-menu-btn="add"]');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  // Teal #1de9b6 = rgb(29, 233, 182).
  expect(activeBg).toContain('rgb(29, 233, 182)');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 336: Studio palette applied — header & status bar #0d1117, active menu teal');

  await app.close();
});
