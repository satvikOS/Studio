import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-camera-follow');

test('Studio V3 — Camera follow tracks selection (slice 590)', async () => {
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

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);

  await win.evaluate(() => window.__studioToggleCameraFollow());

  // Move the cube; orbit target should chase.
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0.8, 0, 0); m.updateMatrixWorld(true);
  });
  // Lerp factor 0.25 — give ~10 frames to settle.
  await win.waitForTimeout(400);

  const tx = await win.evaluate(() => window.__archdiscViewport.orbitControls.target.x);
  expect(tx).toBeGreaterThan(0.3);

  // Toggle off + move; target should stay.
  await win.evaluate(() => window.__studioToggleCameraFollow());
  const stayX = await win.evaluate(() => window.__archdiscViewport.orbitControls.target.x);
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(-2, 0, 0); m.updateMatrixWorld(true);
  });
  await win.waitForTimeout(300);
  const stillX = await win.evaluate(() => window.__archdiscViewport.orbitControls.target.x);
  expect(Math.abs(stillX - stayX)).toBeLessThan(0.05);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 590: target.x with follow', tx.toFixed(3), '· after off', stillX.toFixed(3));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
