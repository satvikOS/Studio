import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-pick-face-from-click');

test('Studio — pick face from NDC click (slice 374)', async () => {
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
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioPickFaceFromClick === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0, 0, 0); m.scale.set(1, 1, 1); m.updateMatrixWorld(true);
    const vp = window.__archdiscViewport;
    vp.camera.position.set(0, 0, 6);
    if (vp.orbitControls) {
      vp.orbitControls.target.set(0, 0, 0);
      vp.orbitControls.update();
    } else {
      vp.camera.lookAt(0, 0, 0);
    }
    vp.camera.updateMatrixWorld(true);
  });
  await win.waitForTimeout(200);

  const r = await win.evaluate(() => window.__studioPickFaceFromClick(0, 0));
  expect(r.ok).toBe(true);
  expect(r.faceIdx).toBeGreaterThanOrEqual(0);
  expect(r.vertIdx.length).toBe(3);
  // Front face centroid sits at z ≈ +0.015 (Studio primitive size = 0.03m).
  expect(Math.abs(r.centroid[2] - 0.015)).toBeLessThan(0.005);
  // Normal points roughly +Z (toward camera).
  expect(r.normal[2]).toBeGreaterThan(0.5);

  // Off-screen → no hit.
  const miss = await win.evaluate(() => window.__studioPickFaceFromClick(2, 2));
  expect(miss.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 374: face pick faceIdx=', r.faceIdx, 'centroidZ=', r.centroid[2].toFixed(3), 'normalZ=', r.normal[2].toFixed(3));

  await app.close();
});
