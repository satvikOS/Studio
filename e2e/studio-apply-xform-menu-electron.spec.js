import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-apply-xform-menu');

test('Studio — Object menu › Apply Transforms (slice 331)', async () => {
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
    m.position.set(0.3, 0, 0); m.scale.set(3, 3, 3); m.updateMatrixWorld(true);
  });

  // Open Object menu → click Apply Transforms.
  await win.locator('[data-studio-header-menu-btn="object"]').click();
  await expect(win.locator('[data-studio-header-menu-item="apply-xform"]')).toBeVisible();
  await win.locator('[data-studio-header-menu-item="apply-xform"]').click();
  await win.waitForTimeout(400);

  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return {
      pos: [m.position.x, m.position.y, m.position.z],
      scl: [m.scale.x, m.scale.y, m.scale.z],
      stamp: m.userData.archdiscStudioAppliedTransforms,
    };
  });
  expect(after.pos[0]).toBeCloseTo(0, 4);
  expect(after.scl[0]).toBeCloseTo(1, 4);
  expect(after.stamp).toBe(1);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 331: Apply Transforms via Object menu reset transform to identity');

  await app.close();
});
