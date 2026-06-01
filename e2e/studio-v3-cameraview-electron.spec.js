import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-cameraview');

test('Studio V3 — camera bookmarks / turntable / FOV / projection (slice 420)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioBookmarkCamera === 'function', null, { timeout: 15000 });

  // Bookmark current camera.
  let r = await win.evaluate(() => window.__studioBookmarkCamera('view-A'));
  expect(r.ok).toBe(true);
  expect(r.name).toBe('view-A');

  // Mutate camera, then restore.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    vp.camera.position.set(1, 1, 1);
    if (vp.orbitControls) vp.orbitControls.update();
  });
  r = await win.evaluate(() => window.__studioRestoreCameraBookmark('view-A'));
  expect(r.ok).toBe(true);
  // Camera position now matches the bookmark.
  const camPos = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    return [vp.camera.position.x, vp.camera.position.y, vp.camera.position.z];
  });
  expect(camPos[0]).toBeCloseTo(r.position[0], 5);
  expect(camPos[1]).toBeCloseTo(r.position[1], 5);
  expect(camPos[2]).toBeCloseTo(r.position[2], 5);

  // List bookmarks.
  const list = await win.evaluate(() => window.__studioListCameraBookmarks());
  expect(list).toContain('view-A');

  // Restore non-existent bookmark.
  r = await win.evaluate(() => window.__studioRestoreCameraBookmark('nope'));
  expect(r.ok).toBe(false);

  // Toggle turntable on/off.
  r = await win.evaluate(() => window.__studioToggleTurntable(0.5));
  expect(r.ok).toBe(true);
  expect(r.on).toBe(true);
  r = await win.evaluate(() => window.__studioToggleTurntable());
  expect(r.on).toBe(false);

  // SetFov — valid + invalid.
  r = await win.evaluate(() => window.__studioSetFov(60));
  expect(r.ok).toBe(true);
  expect(r.fov).toBe(60);
  r = await win.evaluate(() => window.__studioSetFov(500));
  expect(r.ok).toBe(false);

  // ToggleViewProjection.
  const first = await win.evaluate(() => window.__studioToggleViewProjection());
  const second = await win.evaluate(() => window.__studioToggleViewProjection());
  expect(first.projection).not.toBe(second.projection);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 420: bookmarks + turntable + FOV + projection toggle ok');

  await app.close();
});
