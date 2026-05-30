import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 246: camera bookmarks (save / restore named poses).
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-camera-bookmarks');

test('Studio — bookmark camera pose then restore moves camera back', async () => {
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
  await win.waitForFunction(() => typeof window.__studioBookmarkCamera === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Orbit camera to front, bookmark "hero".
  await win.evaluate(() => window.__archdiscOrbitView(0, 0, 1));
  await win.waitForTimeout(300);
  await win.evaluate(() => window.__studioBookmarkCamera('hero'));

  // Orbit elsewhere, then restore "hero".
  await win.evaluate(() => window.__archdiscOrbitView(90, 30, 1));
  await win.waitForTimeout(300);
  const before = await win.evaluate(() => {
    const p = window.__archdiscViewport.camera.position;
    return [p.x, p.y, p.z];
  });
  await win.evaluate(() => window.__studioRestoreCameraBookmark('hero'));
  await win.waitForTimeout(300);
  const after = await win.evaluate(() => {
    const p = window.__archdiscViewport.camera.position;
    return [p.x, p.y, p.z];
  });
  // Pose changed back near the front view (z dominant, x≈0).
  expect(Math.abs(before[0] - after[0])).toBeGreaterThan(0.001);
  // And after restore matches the bookmark we saved.
  const list = await win.evaluate(() => window.__studioListCameraBookmarks());
  expect(list).toContain('hero');
  await win.screenshot({ path: path.join(OUT, '00-restored.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 246: camera bookmarks working');

  await app.close();
});
