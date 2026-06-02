import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-camera-bookmarks');

test('Studio V3 — N-panel camera bookmarks save + restore (slice 517)', async () => {
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
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(500);

  await expect(win.locator('[data-studio-v3-camera-bookmarks]')).toBeVisible();

  // Capture initial camera pos.
  const p0 = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return [c.position.x, c.position.y, c.position.z];
  });

  // Type a name + click +.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-camera-bookmark-draft]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, 'iso');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await win.locator('[data-studio-v3-camera-bookmark-save]').click();
  await win.waitForTimeout(900); // bookmark list polls every 800 ms

  await expect(win.locator('[data-studio-v3-camera-bookmark="iso"]')).toHaveCount(1);

  // Move the camera, then restore.
  await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    c.position.set(20, 20, 20); c.updateMatrixWorld(true);
  });

  await win.locator('[data-studio-v3-camera-bookmark="iso"]').click();
  await win.waitForTimeout(150);

  const p1 = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return [c.position.x, c.position.y, c.position.z];
  });
  const dist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  expect(dist).toBeLessThan(0.01);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 517: bookmark "iso" saved + restored within', dist.toFixed(4));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
