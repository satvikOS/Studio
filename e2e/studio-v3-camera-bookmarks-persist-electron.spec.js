import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-camera-bookmarks-persist');

test('Studio V3 — camera bookmarks survive reload + delete (slice 527)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    window.localStorage.removeItem('studio.v3.cameraBookmarks');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Save two bookmarks.
  await win.evaluate(() => {
    window.__studioBookmarkCamera('alpha');
    const c = window.__archdiscViewport.camera;
    c.position.set(5, 5, 5); c.updateMatrixWorld(true);
    window.__studioBookmarkCamera('beta');
  });

  const persistedAfterSave = await win.evaluate(() => window.localStorage.getItem('studio.v3.cameraBookmarks'));
  expect(persistedAfterSave).toBeTruthy();
  const parsed = JSON.parse(persistedAfterSave);
  expect(Object.keys(parsed)).toEqual(expect.arrayContaining(['alpha', 'beta']));

  // Reload — bookmarks come back even before any op call.
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  const listAfterReload = await win.evaluate(() => window.__studioListCameraBookmarks());
  expect(listAfterReload).toEqual(expect.arrayContaining(['alpha', 'beta']));

  // Delete one + verify storage update.
  await win.evaluate(() => window.__studioDeleteCameraBookmark('alpha'));
  const persistedAfterDelete = await win.evaluate(() => window.localStorage.getItem('studio.v3.cameraBookmarks'));
  const parsed2 = JSON.parse(persistedAfterDelete);
  expect(Object.keys(parsed2)).not.toContain('alpha');
  expect(Object.keys(parsed2)).toContain('beta');

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 527: bookmarks persisted reload + delete · final', Object.keys(parsed2).join(','));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
