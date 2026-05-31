import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-apply-transforms');

test('Studio — Apply Transforms bakes pos/rot/scale into geometry (slice 330)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioApplyTransforms === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Spawn cube, position it + scale it.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0.5, 0, 0);
    m.scale.set(2, 2, 2);
    m.updateMatrixWorld(true);
  });
  await win.waitForTimeout(200);

  // Capture vertex 0 position BEFORE bake.
  const before = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    return {
      v0: [p.getX(0), p.getY(0), p.getZ(0)],
      pos: [m.position.x, m.position.y, m.position.z],
      scl: [m.scale.x, m.scale.y, m.scale.z],
    };
  });

  // Apply transforms.
  const r = await win.evaluate(() => window.__studioApplyTransforms({}));
  expect(r.ok).toBe(true);
  expect(r.applied.position).toBe(true);
  expect(r.applied.scale).toBe(true);

  // After: mesh transform identity; vertex 0 should now be at world position
  // (before vertex local * scale + position).
  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    return {
      v0: [p.getX(0), p.getY(0), p.getZ(0)],
      pos: [m.position.x, m.position.y, m.position.z],
      scl: [m.scale.x, m.scale.y, m.scale.z],
      stamp: m.userData.archdiscStudioAppliedTransforms,
    };
  });
  // Mesh transform reset.
  expect(after.pos[0]).toBeCloseTo(0, 5);
  expect(after.scl[0]).toBeCloseTo(1, 5);
  // Vertex 0 baked: now equals (before.v0 * before.scl + before.pos).
  expect(after.v0[0]).toBeCloseTo(before.v0[0] * before.scl[0] + before.pos[0], 4);
  expect(after.v0[1]).toBeCloseTo(before.v0[1] * before.scl[1] + before.pos[1], 4);
  expect(after.v0[2]).toBeCloseTo(before.v0[2] * before.scl[2] + before.pos[2], 4);
  expect(after.stamp).toBe(1);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 330: applyTransforms baked pos+scale; v0 went from', before.v0, '→', after.v0);

  await app.close();
});
