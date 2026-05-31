import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-pick-vert-from-click');

test('Studio — pick vert from NDC click (slice 373)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioPickVertexFromClick === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0, 0, 0); m.scale.set(1, 1, 1); m.updateMatrixWorld(true);
    // Pull camera back along +Z so it sees the cube from outside.
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

  // Cast a ray from NDC (0, 0) — centre of screen. Should hit cube front
  // face and pick the closest of its 3 vertices.
  const r = await win.evaluate(() => window.__studioPickVertexFromClick(0, 0));
  expect(r.ok).toBe(true);
  expect(r.vertIdx).toBeGreaterThanOrEqual(0);
  expect(r.faceIdx).toBeGreaterThanOrEqual(0);
  expect(r.distance).toBeLessThan(0.2);

  // Off-screen NDC (2, 2) → no hit.
  const miss = await win.evaluate(() => window.__studioPickVertexFromClick(2, 2));
  expect(miss.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 373: click-pick vertIdx=', r.vertIdx, 'faceIdx=', r.faceIdx, 'dist=', r.distance.toFixed(4));

  await app.close();
});
