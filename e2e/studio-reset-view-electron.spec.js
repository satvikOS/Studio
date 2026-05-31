import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-reset-view');

test('Studio — Reset View chip restores default orbit (slice 329)', async () => {
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
  await win.waitForTimeout(800);

  // Move camera to top first.
  await win.locator('[data-studio-axis-chip="top"]').click();
  await win.waitForTimeout(200);
  const top = await win.evaluate(() => window.__archdiscViewport.camera.position.y);
  expect(top).toBeGreaterThan(0.2);

  // Now reset.
  await expect(win.locator('[data-studio-axis-chip="reset"]')).toBeVisible();
  await win.locator('[data-studio-axis-chip="reset"]').click();
  await win.waitForTimeout(200);
  const reset = await win.evaluate(() => {
    const p = window.__archdiscViewport.camera.position;
    return { x: p.x, y: p.y, z: p.z };
  });
  expect(reset.x).toBeCloseTo(0.13, 3);
  expect(reset.y).toBeCloseTo(0.06, 3);
  expect(reset.z).toBeCloseTo(0.13, 3);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 329: reset chip restored camera to', reset);

  await app.close();
});
