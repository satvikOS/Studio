import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-viewport-stats');

test('Studio V3 — viewport stats overlay (FPS / calls / tris) (slice 460)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(1100);

  const overlay = win.locator('[data-studio-v3-viewport-stats]');
  await expect(overlay).toBeVisible();

  // Spawn cube → tri count grows.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(1800);

  const tris = await overlay.getAttribute('data-studio-v3-stats-tris');
  expect(Number(tris)).toBeGreaterThanOrEqual(12);

  // Toggle event hides + shows.
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('studio-toggle-stats')));
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-viewport-stats]')).toHaveCount(0);
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('studio-toggle-stats')));
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-viewport-stats]')).toBeVisible();

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 460: stats overlay shows tris=', tris);

  await app.close();
});
