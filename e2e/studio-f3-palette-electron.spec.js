import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 223: F3 opens the command palette (Blender F3).
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-f3-palette');

test('Studio — F3 opens the command palette', async () => {
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

  // F3 → command palette element with [data-studio-command-palette] appears.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true })));
  await win.waitForTimeout(500);
  const open = await win.evaluate(() => !!document.querySelector('[data-studio-command-palette]'));
  expect(open, 'command palette mounted').toBe(true);
  await win.screenshot({ path: path.join(OUT, '00-palette.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 223: F3 command palette working');

  await app.close();
});
