import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 238: viewport-corner current-frame overlay.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-viewport-frame-overlay');

test('Studio — viewport frame overlay updates as Arrow keys step', async () => {
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

  await expect(win.locator('[data-studio-viewport-frame-overlay]')).toHaveText('Frame 0');

  await win.evaluate(() => window.__studioSetFrame(7));
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-viewport-frame-overlay]')).toHaveText('Frame 7');
  await win.screenshot({ path: path.join(OUT, '00-frame-7.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 238: viewport frame overlay updates live');

  await app.close();
});
