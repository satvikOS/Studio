import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 233: viewport FPS counter.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-viewport-fps');

test('Studio — viewport FPS counter shows live FPS + draw-call count', async () => {
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

  await expect(win.locator('[data-studio-viewport-fps]')).toBeVisible();

  // Wait for first measurement (>500ms after mount).
  await win.waitForTimeout(1200);
  const text = await win.locator('[data-studio-viewport-fps]').textContent();
  expect(text, 'FPS text populated').toMatch(/\d+ FPS · \d+ calls/);
  const fps = await win.evaluate(() => window.__studioFps);
  expect(fps, 'fps mirrored').toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '00-fps.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 233: viewport FPS counter live; got', text);

  await app.close();
});
