import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-rotate-selected-verts');

test('Studio — __studioRotateSelectedVerts rotates around centroid (slice 385)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 500,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => typeof window.__studioRotateSelectedVerts === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0, 0, 0); m.scale.set(1, 1, 1); m.updateMatrixWorld(true);
    window.__studioClearEditSelection();
  });

  // Empty → fail.
  let r = await win.evaluate(() => window.__studioRotateSelectedVerts(Math.PI / 2, 'z'));
  expect(r.ok).toBe(false);

  // Pick face 0 (3 verts). Rotate 180° around z. Each vert should move
  // to its reflection across the centroid (in the X-Y plane component).
  const before = await win.evaluate(() => {
    window.__studioReplaceEditSelection('face', 0);
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    const idx = m.geometry.index.array;
    const a = idx[0];
    return { a, pos: [p.getX(a), p.getY(a), p.getZ(a)], allIdx: [idx[0], idx[1], idx[2]] };
  });

  // Compute centroid from before-pos.
  const beforeAll = await win.evaluate((ids) => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    return ids.map((i) => [p.getX(i), p.getY(i), p.getZ(i)]);
  }, before.allIdx);
  const cx = (beforeAll[0][0] + beforeAll[1][0] + beforeAll[2][0]) / 3;
  const cy = (beforeAll[0][1] + beforeAll[1][1] + beforeAll[2][1]) / 3;

  r = await win.evaluate(() => window.__studioRotateSelectedVerts(Math.PI, 'z'));
  expect(r.ok).toBe(true);
  expect(r.vertCount).toBe(3);

  // After PI z-rotation: new x = cx - (oldX - cx); new y = cy - (oldY - cy); z stays.
  const after = await win.evaluate((i) => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    return [p.getX(i), p.getY(i), p.getZ(i)];
  }, before.a);
  const expX = cx - (before.pos[0] - cx);
  const expY = cy - (before.pos[1] - cy);
  const expZ = before.pos[2];
  expect(Math.abs(after[0] - expX)).toBeLessThan(1e-5);
  expect(Math.abs(after[1] - expY)).toBeLessThan(1e-5);
  expect(Math.abs(after[2] - expZ)).toBeLessThan(1e-5);

  // Reverse rotation puts them back.
  await win.evaluate(() => window.__studioRotateSelectedVerts(Math.PI, 'z'));
  const restored = await win.evaluate((i) => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    return [p.getX(i), p.getY(i), p.getZ(i)];
  }, before.a);
  expect(Math.abs(restored[0] - before.pos[0])).toBeLessThan(1e-5);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 385: rotated 3 verts ±180° around z and restored');

  await app.close();
});
