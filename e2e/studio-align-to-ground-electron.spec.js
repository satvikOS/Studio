import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-align-to-ground');

test('Studio — Align to Ground snaps mesh bottom to y=0 (slice 352)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioAlignToGround === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  // Float the cube up by 1m.
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.y = 1.0; m.updateMatrixWorld(true);
    m.geometry.computeBoundingBox();
  });

  const r = await win.evaluate(() => window.__studioAlignToGround({}));
  expect(r.ok).toBe(true);

  // Verify bbox.min.y now ≈ 0.
  const probe = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.updateMatrixWorld(true);
    const bb = m.geometry.boundingBox.clone();
    bb.applyMatrix4(m.matrixWorld);
    return { minY: bb.min.y, posY: m.position.y };
  });
  expect(Math.abs(probe.minY)).toBeLessThan(1e-5);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 352: align-to-ground — bbox.min.y now', probe.minY.toExponential(2), 'pos.y=', probe.posY.toFixed(4));

  await app.close();
});
