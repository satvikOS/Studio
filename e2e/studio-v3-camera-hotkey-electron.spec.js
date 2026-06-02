import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-camera-hotkey');

test('Studio V3 — Alt+1..9 recalls camera bookmark by index (slice 537)', async () => {
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

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Set up 2 bookmarks at distinct camera positions (within OrbitControls
  // maxDistance=5m — anything past that gets clamped during update()).
  await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    c.position.set(0.5, 0.5, 0.5); c.updateMatrixWorld(true);
    window.__studioBookmarkCamera('alpha');
    c.position.set(2, 2, 2); c.updateMatrixWorld(true);
    window.__studioBookmarkCamera('bravo');
  });

  // Move the camera somewhere else, then press Alt+1 → should restore alpha
  // (alphabetically first).
  await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    c.position.set(1.5, 1.5, 1.5); c.updateMatrixWorld(true);
  });

  await win.keyboard.press('Alt+1');
  await win.waitForTimeout(200);
  let pos = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return [c.position.x, c.position.y, c.position.z];
  });
  expect(pos[0]).toBeCloseTo(0.5, 1);
  expect(pos[1]).toBeCloseTo(0.5, 1);

  // Alt+2 → bravo.
  await win.keyboard.press('Alt+2');
  await win.waitForTimeout(200);
  pos = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return [c.position.x, c.position.y, c.position.z];
  });
  expect(pos[0]).toBeCloseTo(2, 1);
  expect(pos[1]).toBeCloseTo(2, 1);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 537: Alt+1 → alpha · Alt+2 → bravo · positions ok');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
