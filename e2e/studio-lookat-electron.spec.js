import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-lookat');

test('Studio — __studioLookAt orients selected mesh at target (slice 351)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioLookAt === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  // Move cube off-origin (single evaluate so the function reference stays stable).
  const r = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0, 0, 0.5); m.rotation.set(0, 0, 0); m.updateMatrixWorld(true);
    return window.__studioLookAt([1, 0, 0]);
  });
  expect(r.ok).toBe(true);
  // After lookAt, rotation should be non-zero (-Z axis now points to (1, 0, 0) - (0, 0, 0.5)).
  const ry = await win.evaluate(() => window.__studioSelectedMesh().rotation.y);
  expect(Math.abs(ry)).toBeGreaterThan(0.1);

  const bad = await win.evaluate(() => window.__studioLookAt('bad-uuid'));
  expect(bad.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 351: lookAt set rotation.y =', ry.toFixed(3));

  await app.close();
});
