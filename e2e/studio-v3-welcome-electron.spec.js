import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-welcome');

test('Studio V3 — empty-scene welcome card (slice 427)', async () => {
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
  await win.waitForTimeout(700);

  // Empty scene → welcome card shows.
  const card = win.locator('[data-studio-v3-welcome]');
  await expect(card).toBeVisible({ timeout: 5000 });
  await expect(card).toContainText('ArchDisc Studio');
  await expect(card).toContainText('Tab');
  await expect(card).toContainText('vert');

  // Spawn → card hides within the next poll.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(700);
  await expect(win.locator('[data-studio-v3-welcome]')).toHaveCount(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 427: V3 welcome card shows on empty, hides after spawn');

  await app.close();
});
