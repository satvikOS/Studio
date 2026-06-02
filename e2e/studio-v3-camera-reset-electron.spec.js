import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-camera-reset');

test('Studio V3 — Cmd+R resets camera home (slice 556)', async () => {
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
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Move the camera + orbit target somewhere unusual.
  await win.evaluate(() => {
    const v = window.__archdiscViewport;
    v.camera.position.set(3, 3, 3); v.camera.updateMatrixWorld(true);
    v.orbitControls.target.set(1, 1, 1);
    v.orbitControls.update();
  });

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await win.keyboard.press('Meta+r');
  await win.waitForTimeout(250);

  const target = await win.evaluate(() => {
    const t = window.__archdiscViewport.orbitControls.target;
    return [t.x, t.y, t.z];
  });
  expect(Math.abs(target[0])).toBeLessThan(0.5);
  expect(Math.abs(target[1])).toBeLessThan(0.5);
  expect(Math.abs(target[2])).toBeLessThan(0.5);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 556: Cmd+R reset target to', target.map((n) => n.toFixed(3)).join(','));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
