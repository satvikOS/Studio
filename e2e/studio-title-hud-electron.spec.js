import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-title-hud');

test('Studio — title HUD updates body count (slice 272)', async () => {
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

  await expect(win.locator('[data-studio-viewport-title]')).toHaveText('Untitled scene');
  await expect(win.locator('[data-studio-viewport-title-count]')).toHaveText('0 bodies');

  // Spawn a cube via ribbon → count goes 1.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-viewport-title-count]')).toHaveText('1 bodies');
  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 272: title HUD updated to "1 bodies"');

  await app.close();
});
