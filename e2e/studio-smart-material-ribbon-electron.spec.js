import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-smart-material-ribbon');

test('Studio — Smart Material ribbon buttons (slice 311)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioApplySmartMaterial === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Spawn a cube so selectedKind is truthy and the buttons enable.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);

  await expect(win.locator('[data-studio-ribbon-action="smart-rust"]')).toBeVisible();
  await expect(win.locator('[data-studio-ribbon-action="smart-concrete"]')).toBeVisible();
  await expect(win.locator('[data-studio-ribbon-action="smart-stone"]')).toBeVisible();

  // Apply Concrete preset via ribbon.
  await win.locator('[data-studio-ribbon-action="smart-concrete"]').click();
  await win.waitForTimeout(500);
  const stamp = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return {
      stamp: m.userData.archdiscStudioSmartMat,
      hasMap: !!m.material.map,
      hasRough: !!m.material.roughnessMap,
      hasAO: !!m.material.aoMap,
      met: m.material.metalness,
    };
  });
  expect(stamp.stamp).toBe('concrete');
  expect(stamp.hasMap).toBe(true);
  expect(stamp.hasRough).toBe(true);
  expect(stamp.hasAO).toBe(true);
  expect(stamp.met).toBeCloseTo(0.0, 5);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 311: SM Concrete ribbon button applied — map/rough/ao all bound');

  await app.close();
});
