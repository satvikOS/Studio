import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-terrain-ribbon');

test('Studio — Terrain ribbon button spawns landscape (slice 305)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioTerrainAdd === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Before: no terrain in scene.
  const before = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.studioTerrain) n++; });
    return n;
  });
  expect(before).toBe(0);

  await expect(win.locator('[data-studio-primitive="terrain"]')).toBeVisible();
  await win.locator('[data-studio-primitive="terrain"]').click();
  await win.waitForTimeout(500);

  const after = await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.studioTerrain) m = o; });
    return m ? {
      uuid: m.uuid,
      width: m.userData.studioTerrain.width,
      segments: m.userData.studioTerrain.segments,
      isMesh: m.isMesh,
    } : null;
  });
  expect(after).toBeTruthy();
  expect(after.isMesh).toBe(true);
  expect(after.width).toBe(10);
  expect(after.segments).toBe(64);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 305: Terrain ribbon spawned a', after.width, 'x', after.width, 'terrain at', after.segments, 'segments');

  await app.close();
});
