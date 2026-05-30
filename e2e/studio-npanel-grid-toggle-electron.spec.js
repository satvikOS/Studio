import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 235: Grid toggle checkbox in N-panel View tab.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-npanel-grid-toggle');

test('Studio — N-panel View grid checkbox toggles grid visibility', async () => {
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
  await win.waitForFunction(() => !!window.__studioGrid, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(300);

  // Uncheck grid.
  await win.evaluate(() => {
    const cb = document.querySelector('[data-studio-npanel-grid]');
    cb.click();
  });
  await win.waitForTimeout(300);
  expect(await win.evaluate(() => window.__studioGrid.visible)).toBe(false);
  await win.screenshot({ path: path.join(OUT, '00-no-grid.png') });

  // Re-check grid.
  await win.evaluate(() => document.querySelector('[data-studio-npanel-grid]').click());
  await win.waitForTimeout(300);
  expect(await win.evaluate(() => window.__studioGrid.visible)).toBe(true);
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 235: N-panel grid toggle working');

  await app.close();
});
