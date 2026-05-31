import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-fit-selected');

test('Studio — Frame Selected (slice 368)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioFitSelected === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  // Push the cube far off-center so the camera has to move noticeably.
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0.5, 0.25, -0.3); m.updateMatrixWorld(true);
    m.geometry.computeBoundingSphere();
  });

  const r = await win.evaluate(() => window.__studioFitSelected());
  expect(r.ok).toBe(true);
  expect(r.center[0]).toBeCloseTo(0.5, 3);
  expect(r.center[1]).toBeCloseTo(0.25, 3);
  expect(r.center[2]).toBeCloseTo(-0.3, 3);

  // Orbit target should now be the cube position.
  const target = await win.evaluate(() => {
    const c = window.__archdiscViewport.orbitControls;
    return c && c.target ? [c.target.x, c.target.y, c.target.z] : null;
  });
  expect(target[0]).toBeCloseTo(0.5, 3);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 368: fit-selected moved orbit target to', target.map(v=>v.toFixed(3)));

  await app.close();
});
