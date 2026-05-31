import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-fov');

test('Studio — FOV slider changes camera.fov (slice 273)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetFov === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  await win.evaluate(() => window.__studioSetFov(85));
  expect(await win.evaluate(() => window.__archdiscViewport.camera.fov)).toBeCloseTo(85, 1);
  expect(await win.evaluate(() => window.__studioCamFov)).toBe(85);

  // Clamp
  await win.evaluate(() => window.__studioSetFov(999));
  expect(await win.evaluate(() => window.__archdiscViewport.camera.fov)).toBe(110);

  await win.evaluate(() => window.__studioSetFov(50));
  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 273: FOV control working');

  await app.close();
});
