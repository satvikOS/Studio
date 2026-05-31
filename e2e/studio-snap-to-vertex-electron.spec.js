import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-snap-to-vertex');

test('Studio — Snap to vertex moves mesh\'s closest vert onto target (slice 357)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSnapToVertex === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);

  // Snap to world point [0.5, 0, 0].
  const r = await win.evaluate(() => window.__studioSnapToVertex([0.5, 0, 0]));
  expect(r.ok).toBe(true);
  expect(r.snappedIdx).toBeGreaterThanOrEqual(0);

  // After snap, the closest vertex should be at [0.5, 0, 0] within tolerance.
  const verify = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.updateMatrixWorld(true);
    const pos = m.geometry.attributes.position;
    const tmp = new (window.__archdiscScene.constructor.prototype.constructor.bind?.() || class { })();
    let bestD = Infinity, best = [0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
      const wm = m.matrixWorld.elements;
      const wx = wm[0] * vx + wm[4] * vy + wm[8] * vz + wm[12];
      const wy = wm[1] * vx + wm[5] * vy + wm[9] * vz + wm[13];
      const wz = wm[2] * vx + wm[6] * vy + wm[10] * vz + wm[14];
      const d = Math.hypot(wx - 0.5, wy, wz);
      if (d < bestD) { bestD = d; best = [wx, wy, wz]; }
    }
    return { bestD, best };
  });
  expect(verify.bestD).toBeLessThan(1e-5);

  // Bad arg returns ok:false.
  const bad = await win.evaluate(() => window.__studioSnapToVertex('nope'));
  expect(bad.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 357: snap-to-vertex snapped at distance', verify.bestD.toExponential(2));

  await app.close();
});
