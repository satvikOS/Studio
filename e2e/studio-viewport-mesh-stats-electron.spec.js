import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-viewport-mesh-stats');

test('Studio — selected-mesh stats overlay (slice 391)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 500,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await expect(win.locator('[data-studio-viewport-mesh-stats]')).toHaveCount(1);
  await win.waitForTimeout(1100);

  const overlay = win.locator('[data-studio-viewport-mesh-stats]');

  // No mesh → overlay hidden.
  let display = await overlay.evaluate((el) => getComputedStyle(el).display);
  expect(display).toBe('none');

  // Spawn cube → overlay shows v 24 t 12.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(1100);
  await expect(overlay).toHaveAttribute('data-studio-mesh-v', '24');
  await expect(overlay).toHaveAttribute('data-studio-mesh-t', '12');
  // Cube triangulation has 30 unique edges (per the slice 386 / 387 math).
  await expect(overlay).toHaveAttribute('data-studio-mesh-e', '30');
  display = await overlay.evaluate((el) => getComputedStyle(el).display);
  expect(display).toBe('block');

  // Extrude a face → counts climb to 27 / 18 tri / N edges.
  await win.evaluate(() => {
    window.__studioSetEditMode('face');
    window.__studioReplaceEditSelection('face', 0);
    window.__studioExtrudeSelectedFaces(0.01);
  });
  await win.waitForTimeout(1100);
  await expect(overlay).toHaveAttribute('data-studio-mesh-v', '27');
  await expect(overlay).toHaveAttribute('data-studio-mesh-t', '18');

  await win.evaluate(() => window.__studioSetEditMode('object'));
  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 391: mesh stats overlay reflects cube + extrude growth');

  await app.close();
});
