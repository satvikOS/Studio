import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 40 — Camera controls (FOV slider + view presets).
 *
 * Drives the PerspectiveCamera's FOV directly (15–110°) and orbits
 * the camera to named view presets — Front / Back / Right / Left /
 * Top / Iso. The FOV change updates camera.projectionMatrix so the
 * viewport actually re-renders with the new field of view.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-camera');

async function setRange(win, selector, value) {
  await win.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel: selector, val: value });
}

async function cameraState(win) {
  return await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.camera) return null;
    return {
      fov: vp.camera.fov,
      px: +vp.camera.position.x.toFixed(4),
      py: +vp.camera.position.y.toFixed(4),
      pz: +vp.camera.position.z.toFixed(4),
    };
  });
}

test('Studio camera — FOV slider + view presets drive the viewport', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 2200,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Compose a small scene so the camera presets have something to frame.
  for (const k of ['cube', 'sphere', 'cone']) {
    await win.locator(`[data-studio-primitive="${k}"]`).click();
    await win.waitForTimeout(200);
  }

  await expect(win.locator('[data-studio-section="camera"]')).toBeVisible();
  await expect(win.locator('[data-studio-camera-readout="fov"]')).toHaveText('45°');
  await expect(win.locator('[data-studio-camera-preset]')).toHaveCount(6);

  // ---- FOV — slide to 80, verify camera.fov updates ----
  await setRange(win, '[data-studio-camera="fov"]', '80');
  await expect(win.locator('[data-studio-camera-readout="fov"]')).toHaveText('80°');
  const fovHi = await cameraState(win);
  expect(fovHi.fov).toBe(80);
  await win.screenshot({ path: path.join(OUT, '00-fov-80.png'), fullPage: false });

  // FOV down to 25, verify
  await setRange(win, '[data-studio-camera="fov"]', '25');
  await expect(win.locator('[data-studio-camera-readout="fov"]')).toHaveText('25°');
  const fovLow = await cameraState(win);
  expect(fovLow.fov).toBe(25);
  await win.screenshot({ path: path.join(OUT, '01-fov-25.png'), fullPage: false });

  // Restore default 45
  await setRange(win, '[data-studio-camera="fov"]', '45');
  await win.waitForTimeout(200);

  // ---- View presets — each orbit moves the camera to a recognisable
  //                     position; positions are pairwise distinct. ----
  const presets = ['front', 'back', 'right', 'left', 'top', 'iso'];
  const observed = [];
  for (const id of presets) {
    await win.locator(`[data-studio-camera-preset="${id}"]`).click();
    await win.waitForTimeout(300);
    const s = await cameraState(win);
    observed.push({ id, ...s });
    await win.screenshot({ path: path.join(OUT, `02-view-${id}.png`), fullPage: false });
  }
  // No two preset views share the same camera position.
  const positions = new Set(observed.map(o => `${o.px}|${o.py}|${o.pz}`));
  expect(positions.size).toBe(6);

  // eslint-disable-next-line no-console
  console.log(`  camera: fov 45→80→25→45; presets ${presets.length} distinct positions`);

  await app.close();
});
