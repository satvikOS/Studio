import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-drop-center-ribbon');

test('Studio — ribbon buttons for Drop / Center (slice 356)', async () => {
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
    m.position.set(0.4, 0.6, 0.2); m.updateMatrixWorld(true);
    m.geometry.computeBoundingBox();
  });

  // Click Center — bbox centre snaps to origin.
  await expect(win.locator('[data-studio-ribbon-action="center-origin"]')).toBeEnabled();
  await win.locator('[data-studio-ribbon-action="center-origin"]').click();
  await win.waitForTimeout(300);
  const centred = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.updateMatrixWorld(true);
    const bb = m.geometry.boundingBox.clone(); bb.applyMatrix4(m.matrixWorld);
    return [(bb.min.x + bb.max.x) * 0.5, (bb.min.y + bb.max.y) * 0.5, (bb.min.z + bb.max.z) * 0.5];
  });
  expect(Math.abs(centred[0])).toBeLessThan(1e-5);
  expect(Math.abs(centred[1])).toBeLessThan(1e-5);

  // Click Drop — bbox min.y snaps to 0.
  await win.locator('[data-studio-ribbon-action="drop-to-ground"]').click();
  await win.waitForTimeout(300);
  const dropped = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.updateMatrixWorld(true);
    const bb = m.geometry.boundingBox.clone(); bb.applyMatrix4(m.matrixWorld);
    return bb.min.y;
  });
  expect(Math.abs(dropped)).toBeLessThan(1e-5);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 356: Center + Drop ribbon buttons working');

  await app.close();
});
