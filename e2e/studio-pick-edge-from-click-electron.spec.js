import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-pick-edge-from-click');

test('Studio — pick edge from NDC click (slice 375)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioPickEdgeFromClick === 'function', null, { timeout: 30000 });
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

  // Centre-screen NDC hits the front face. Returns one of its 2 edges.
  const r = await win.evaluate(() => window.__studioPickEdgeFromClick(0, 0));
  expect(r.ok).toBe(true);
  expect(r.faceIdx).toBeGreaterThanOrEqual(0);
  expect(r.vertIdx.length).toBe(2);
  expect(r.vertIdx[0]).not.toBe(r.vertIdx[1]);
  // Edge length: either a 0.03 m cube edge or a 0.042 m face diagonal
  // (BoxGeometry triangulates each face with the diagonal as shared edge).
  expect(r.length).toBeGreaterThan(0.02);
  expect(r.length).toBeLessThan(0.05);
  // Closest-to-hit distance must be ~0 since hit point lies on triangle.
  expect(r.distance).toBeLessThan(0.01);

  // Off-screen → no hit.
  const miss = await win.evaluate(() => window.__studioPickEdgeFromClick(2, 2));
  expect(miss.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 375: edge pick vertIdx=', r.vertIdx, 'len=', r.length.toFixed(4), 'dist=', r.distance.toFixed(4));

  await app.close();
});
