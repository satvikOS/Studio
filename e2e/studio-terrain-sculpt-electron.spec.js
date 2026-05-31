import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-terrain-sculpt');

test('Studio — UE landscape terrain + raise/lower brush (slice 304)', async () => {
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

  // Add a 10x10 terrain at 32 segments.
  const add = await win.evaluate(() => window.__studioTerrainAdd({ width: 10, depth: 10, segments: 32 }));
  expect(add.ok).toBe(true);
  expect(add.uuid).toBeTruthy();

  // Raise at center 5 times so the bump is visible.
  for (let i = 0; i < 5; i++) {
    await win.evaluate(() => window.__studioTerrainSculpt({
      worldX: 0, worldZ: 0, mode: 'raise', radius: 2.0, strength: 0.3,
    }));
  }
  const raised = await win.evaluate(({ u }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) m = o; });
    const t = m.userData.studioTerrain;
    const c = Math.floor(t.n / 2) * t.n + Math.floor(t.n / 2);
    return t.heightmap[c];
  }, { u: add.uuid });
  expect(raised).toBeGreaterThan(0.1);
  await win.screenshot({ path: path.join(OUT, '00-raised.png') });
  await win.waitForTimeout(400);

  // Lower at same spot 5 times.
  for (let i = 0; i < 5; i++) {
    await win.evaluate(() => window.__studioTerrainSculpt({
      worldX: 0, worldZ: 0, mode: 'lower', radius: 2.0, strength: 0.3,
    }));
  }
  const lowered = await win.evaluate(({ u }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) m = o; });
    const t = m.userData.studioTerrain;
    const c = Math.floor(t.n / 2) * t.n + Math.floor(t.n / 2);
    return t.heightmap[c];
  }, { u: add.uuid });
  expect(lowered).toBeLessThan(raised - 0.1);
  await win.screenshot({ path: path.join(OUT, '01-lowered.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 304: terrain raised to', raised.toFixed(3), '; lowered to', lowered.toFixed(3));

  await app.close();
});
