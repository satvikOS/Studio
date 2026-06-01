import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-camera-axis-hotkey');

test('Studio V3 — 1/3/7 set camera axis in object mode (slice 449)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetCameraAxis === 'function', null, { timeout: 15000 });

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Object mode by default.
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('object');

  // Press 7 → top view. The camera Y should now be > X / Z components.
  await win.keyboard.press('7');
  await win.waitForTimeout(200);
  let pos = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return [c.position.x, c.position.y, c.position.z];
  });
  expect(pos[1]).toBeGreaterThan(Math.abs(pos[0]));
  expect(pos[1]).toBeGreaterThan(Math.abs(pos[2]));

  // Press 1 → front view. Camera Z > X / Y in magnitude.
  await win.keyboard.press('1');
  await win.waitForTimeout(200);
  pos = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return [c.position.x, c.position.y, c.position.z];
  });
  expect(Math.abs(pos[2])).toBeGreaterThan(Math.abs(pos[0]));

  // Press 3 → side. Camera X > Y / Z.
  await win.keyboard.press('3');
  await win.waitForTimeout(200);
  pos = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return [c.position.x, c.position.y, c.position.z];
  });
  expect(Math.abs(pos[0])).toBeGreaterThan(Math.abs(pos[2]));

  // Flip to vertex mode → 1 should now flip sub-mode, NOT axis.
  await win.evaluate(() => window.__studioSetEditMode('vertex'));
  const beforeCam = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return [c.position.x, c.position.y, c.position.z];
  });
  await win.keyboard.press('1');
  await win.waitForTimeout(200);
  const afterCam = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return [c.position.x, c.position.y, c.position.z];
  });
  // Camera unchanged.
  expect(Math.abs(afterCam[0] - beforeCam[0])).toBeLessThan(1e-3);
  // But edit mode still vertex (1 → vertex in sub-mode handler).
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('vertex');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 449: 7 / 1 / 3 set top / front / side in object mode; sub-mode unaffected');

  await app.close();
});
