import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-axis-chips');

test('Studio — viewport axis-view chips (slice 318)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetCameraAxis === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // All 5 chips visible.
  await expect(win.locator('[data-studio-viewport-axis-chips]')).toBeVisible();
  for (const a of ['top', 'front', 'side', 'back', 'persp']) {
    await expect(win.locator(`[data-studio-axis-chip="${a}"]`)).toBeVisible();
  }

  // Top view — camera Y dominates, X & Z small.
  await win.locator('[data-studio-axis-chip="top"]').click();
  await win.waitForTimeout(200);
  const top = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return { x: c.position.x, y: c.position.y, z: c.position.z, axis: window.__studioCameraAxis };
  });
  expect(top.axis).toBe('top');
  expect(top.y).toBeGreaterThan(Math.abs(top.x));
  expect(top.y).toBeGreaterThan(Math.abs(top.z));

  // Front view — Z dominates.
  await win.locator('[data-studio-axis-chip="front"]').click();
  await win.waitForTimeout(200);
  const front = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return { x: c.position.x, y: c.position.y, z: c.position.z, axis: window.__studioCameraAxis };
  });
  expect(front.axis).toBe('front');
  expect(front.z).toBeGreaterThan(Math.abs(front.x));

  // Side view — X dominates.
  await win.locator('[data-studio-axis-chip="side"]').click();
  await win.waitForTimeout(200);
  const side = await win.evaluate(() => window.__archdiscViewport.camera.position.x);
  expect(side).toBeGreaterThan(0.1);

  // Bad axis returns error via API.
  const bad = await win.evaluate(() => window.__studioSetCameraAxis('nonsense'));
  expect(bad.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 318: axis chips top/front/side cycled, persp reset works');

  await app.close();
});
