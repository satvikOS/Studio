import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-npanel-transform-inputs');

test('Studio — N-panel numeric XYZ inputs for Loc/Rot/Scale (slice 316)', async () => {
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

  // Spawn (auto-selects) cube.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);

  // Inputs should be present.
  await expect(win.locator('[data-studio-npanel-edit="position-x"]')).toBeVisible();
  await expect(win.locator('[data-studio-npanel-edit="rotation-y"]')).toBeVisible();
  await expect(win.locator('[data-studio-npanel-edit="scale-z"]')).toBeVisible();

  // Helper — drive React-controlled inputs by selecting all then typing.
  // fill() alone fights React's controlled value rebind; select+type triggers
  // the same key events a user generates.
  const setNum = async (kind, axis, value) => {
    const sel = `[data-studio-npanel-edit="${kind}-${axis}"]`;
    const loc = win.locator(sel);
    await loc.click();
    await loc.press('ControlOrMeta+A');
    await loc.press('Delete');
    await loc.type(String(value));
    await loc.press('Tab');
    await win.waitForTimeout(200);
  };

  await setNum('position', 'x', 1.5);
  const x = await win.evaluate(() => window.__studioSelectedMesh().position.x);
  expect(x).toBeCloseTo(1.5, 3);

  await setNum('rotation', 'y', 45);
  const ry = await win.evaluate(() => window.__studioSelectedMesh().rotation.y);
  expect(ry).toBeCloseTo(Math.PI / 4, 2);

  await setNum('scale', 'z', 2);
  const sz = await win.evaluate(() => window.__studioSelectedMesh().scale.z);
  expect(sz).toBeCloseTo(2, 3);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 316: N-panel transform inputs — set x=1.5 ry=45° sz=2 directly');

  await app.close();
});
