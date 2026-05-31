import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-center-at-origin');

test('Studio — Center mesh at world origin (slice 355)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioCenterAtOrigin === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  // Float cube somewhere off-origin.
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0.3, 0.4, -0.2); m.updateMatrixWorld(true);
    m.geometry.computeBoundingBox();
  });

  const r = await win.evaluate(() => window.__studioCenterAtOrigin());
  expect(r.ok).toBe(true);

  // Post-center: world bbox center ≈ (0,0,0).
  const probe = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.updateMatrixWorld(true);
    const bb = m.geometry.boundingBox.clone();
    bb.applyMatrix4(m.matrixWorld);
    return {
      cx: (bb.min.x + bb.max.x) * 0.5,
      cy: (bb.min.y + bb.max.y) * 0.5,
      cz: (bb.min.z + bb.max.z) * 0.5,
    };
  });
  expect(Math.abs(probe.cx)).toBeLessThan(1e-5);
  expect(Math.abs(probe.cy)).toBeLessThan(1e-5);
  expect(Math.abs(probe.cz)).toBeLessThan(1e-5);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 355: center-at-origin — bbox centre now (', probe.cx.toExponential(2), ',', probe.cy.toExponential(2), ',', probe.cz.toExponential(2), ')');

  await app.close();
});
