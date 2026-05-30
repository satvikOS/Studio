import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-dolly');

test('Studio — Numpad +/- dolly camera in/out (slice 266)', async () => {
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

  const before = await win.evaluate(() => {
    const p = window.__archdiscViewport.camera.position;
    return Math.hypot(p.x, p.y, p.z);
  });

  // Dolly out (-) twice
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true })));
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true })));
  await win.waitForTimeout(300);
  const afterOut = await win.evaluate(() => {
    const p = window.__archdiscViewport.camera.position;
    return Math.hypot(p.x, p.y, p.z);
  });
  expect(afterOut, 'camera moved farther').toBeGreaterThan(before * 1.1);

  // Dolly in (+) thrice
  for (let i = 0; i < 3; i++) {
    await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true })));
  }
  await win.waitForTimeout(300);
  const afterIn = await win.evaluate(() => {
    const p = window.__archdiscViewport.camera.position;
    return Math.hypot(p.x, p.y, p.z);
  });
  expect(afterIn, 'camera moved closer than after-out').toBeLessThan(afterOut);
  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 266: dist before=', before, 'afterOut=', afterOut, 'afterIn=', afterIn);

  await app.close();
});
