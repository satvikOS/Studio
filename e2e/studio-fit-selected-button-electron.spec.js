import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-fit-selected-button');

test('Studio — viewport-header Fit button (slice 369)', async () => {
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
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0.6, 0.2, 0); m.updateMatrixWorld(true);
    m.geometry.computeBoundingSphere();
  });

  await expect(win.locator('[data-studio-viewport-fit-selected]')).toBeVisible();
  await win.locator('[data-studio-viewport-fit-selected]').click();
  await win.waitForTimeout(300);

  // Orbit target should now be at the cube position.
  const tgt = await win.evaluate(() => {
    const c = window.__archdiscViewport.orbitControls;
    return c && c.target ? [c.target.x, c.target.y, c.target.z] : null;
  });
  expect(tgt[0]).toBeCloseTo(0.6, 3);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 369: fit button moved orbit target to', tgt.map(v=>v.toFixed(3)));

  await app.close();
});
