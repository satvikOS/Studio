import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-move-vertex');

test('Studio — move single vertex by delta (slice 361)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioMoveVertex === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  // Force cube to origin so world == local for our delta.
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1); m.updateMatrixWorld(true);
  });

  // Capture v0 before.
  const before = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    return { v0: [p.getX(0), p.getY(0), p.getZ(0)], uuid: m.uuid };
  });

  // Move vert 0 by (+0.01, +0.02, +0.03) world.
  const r = await win.evaluate(({ uuid }) => window.__studioMoveVertex(uuid, 0, [0.01, 0.02, 0.03]), { uuid: before.uuid });
  expect(r.ok).toBe(true);
  expect(r.vertIdx).toBe(0);

  // Verify v0 shifted by exactly the delta (cube at identity, world == local).
  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    return { v0: [p.getX(0), p.getY(0), p.getZ(0)] };
  });
  expect(after.v0[0] - before.v0[0]).toBeCloseTo(0.01, 5);
  expect(after.v0[1] - before.v0[1]).toBeCloseTo(0.02, 5);
  expect(after.v0[2] - before.v0[2]).toBeCloseTo(0.03, 5);

  // Bad index.
  const bad = await win.evaluate(({ uuid }) => window.__studioMoveVertex(uuid, 99999, [0, 0, 0]), { uuid: before.uuid });
  expect(bad.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 361: moved vert 0 by (0.01, 0.02, 0.03) world; new pos', after.v0.map(v=>v.toFixed(4)));

  await app.close();
});
