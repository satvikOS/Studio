import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-turntable');

test('Studio — Turntable button toggles autoRotate (slice 268)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioToggleTurntable === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(300);
  await win.evaluate(() => document.querySelector('[data-studio-npanel-turntable]').click());
  expect(await win.evaluate(() => window.__studioTurntableOn)).toBe(true);
  expect(await win.evaluate(() => window.__archdiscViewport.orbitControls.autoRotate)).toBe(true);
  await win.waitForTimeout(1500); // let it visibly rotate
  await win.screenshot({ path: path.join(OUT, '00-rotating.png') });

  await win.evaluate(() => document.querySelector('[data-studio-npanel-turntable]').click());
  expect(await win.evaluate(() => window.__studioTurntableOn)).toBe(false);
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 268: turntable toggle works');

  await app.close();
});
