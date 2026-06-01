import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-dolly-hotkey');

test('Studio V3 — + / - dolly the camera (slice 452)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  const startDist = await win.evaluate(() => {
    const v = window.__archdiscViewport;
    const t = (v.orbitControls && v.orbitControls.target) || { x: 0, y: 0, z: 0 };
    const p = v.camera.position;
    return Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z);
  });

  // Press - twice — camera should move farther.
  await win.keyboard.press('-');
  await win.keyboard.press('-');
  await win.waitForTimeout(150);
  const farDist = await win.evaluate(() => {
    const v = window.__archdiscViewport;
    const t = (v.orbitControls && v.orbitControls.target) || { x: 0, y: 0, z: 0 };
    const p = v.camera.position;
    return Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z);
  });
  expect(farDist).toBeGreaterThan(startDist * 1.1);

  // Press + (= on US layout) twice — closer.
  await win.keyboard.press('=');
  await win.keyboard.press('=');
  await win.keyboard.press('=');
  await win.waitForTimeout(150);
  const closeDist = await win.evaluate(() => {
    const v = window.__archdiscViewport;
    const t = (v.orbitControls && v.orbitControls.target) || { x: 0, y: 0, z: 0 };
    const p = v.camera.position;
    return Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z);
  });
  expect(closeDist).toBeLessThan(farDist * 0.95);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 452: dist', startDist.toFixed(3), '→', farDist.toFixed(3), '→', closeDist.toFixed(3));

  await app.close();
});
