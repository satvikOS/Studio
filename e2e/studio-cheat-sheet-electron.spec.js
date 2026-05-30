import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 239: F1 keymap cheat-sheet overlay.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-cheat-sheet');

test('Studio — F1 toggles the keymap cheat-sheet overlay', async () => {
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

  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true })));
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-cheat-sheet="open"]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '00-open.png') });

  // F1 again -> closes.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true })));
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-cheat-sheet="open"]')).toHaveCount(0);
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 239: cheat sheet toggle working');

  await app.close();
});
