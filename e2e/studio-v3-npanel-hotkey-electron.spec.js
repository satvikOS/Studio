import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-npanel-hotkey');

test('Studio V3 — N toggles right panel (slice 448)', async () => {
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
  await win.waitForTimeout(400);

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Default: panel expanded.
  const expanded = win.locator('[data-studio-v3-right][data-collapsed="false"]');
  await expect(expanded).toBeVisible();

  // N → collapse.
  await win.keyboard.press('n');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-right][data-collapsed="true"]')).toBeVisible();

  // N → expand.
  await win.keyboard.press('n');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-right][data-collapsed="false"]')).toBeVisible();

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 448: N toggles right panel collapsed ↔ expanded');

  await app.close();
});
