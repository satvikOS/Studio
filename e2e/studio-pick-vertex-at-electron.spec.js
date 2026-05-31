import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-pick-vertex-at');

test('Studio — pick closest vertex by world point (slice 360)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioPickVertexAt === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  // Force cube to origin so the probe coordinates are absolute.
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0, 0, 0); m.updateMatrixWorld(true);
  });

  // Probe near a corner of the cube — should find the +x+y+z corner vert.
  const r = await win.evaluate(() => window.__studioPickVertexAt([0.05, 0.05, 0.05]));
  expect(r.ok).toBe(true);
  expect(r.vertIdx).toBeGreaterThanOrEqual(0);
  // Picked vert should be in positive octant.
  expect(r.point[0]).toBeGreaterThan(0);
  expect(r.point[1]).toBeGreaterThan(0);
  expect(r.point[2]).toBeGreaterThan(0);

  // Probe near (-0.05, -0.05, -0.05) — negative octant corner.
  const r2 = await win.evaluate(() => window.__studioPickVertexAt([-0.05, -0.05, -0.05]));
  expect(r2.point[0]).toBeLessThan(0);
  expect(r2.point[1]).toBeLessThan(0);
  expect(r2.point[2]).toBeLessThan(0);

  // Different vertices.
  expect(r.vertIdx).not.toBe(r2.vertIdx);

  // Bad arg.
  const bad = await win.evaluate(() => window.__studioPickVertexAt('nope'));
  expect(bad.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 360: pick-vertex +xyz=', r.point.map(v=>v.toFixed(4)), '-xyz=', r2.point.map(v=>v.toFixed(4)));

  await app.close();
});
