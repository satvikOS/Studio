import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 236: N-panel BG colour preset swatches.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-bg-presets');

test('Studio — N-panel BG preset swatch sets viewport background', async () => {
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

  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(300);

  await win.evaluate(() => document.querySelector('[data-studio-npanel-bg-preset="#bdbdbd"]').click());
  await win.waitForTimeout(300);
  const bg = await win.evaluate(() => ({
    mirror: window.__studioBgColor,
    scene: window.__archdiscViewport.scene.background.getHexString(),
  }));
  expect(bg.mirror).toBe('#bdbdbd');
  expect(bg.scene).toBe('bdbdbd');
  await win.screenshot({ path: path.join(OUT, '00-grey-preset.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 236: BG presets working');

  await app.close();
});
