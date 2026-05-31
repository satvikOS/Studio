import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-viewport-welcome');

test('Studio — empty-scene welcome card (slice 392)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 500,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForTimeout(400);

  // Empty scene → welcome shows.
  const card = win.locator('[data-studio-viewport-welcome]');
  await expect(card).toBeVisible();

  // Card content references the muscle-memory hotkeys.
  await expect(card).toContainText('ArchDisc Studio');
  await expect(card).toContainText('Tab');
  await expect(card).toContainText('vert');

  // Spawn first primitive → welcome disappears.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  await expect(card).toHaveCount(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 392: welcome card present on empty scene, hidden after spawn');

  await app.close();
});
