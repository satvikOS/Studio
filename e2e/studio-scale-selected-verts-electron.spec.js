import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-scale-selected-verts');

test('Studio — __studioScaleSelectedVerts scales around centroid (slice 384)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioScaleSelectedVerts === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0, 0, 0); m.scale.set(1, 1, 1); m.updateMatrixWorld(true);
    window.__studioClearEditSelection();
  });

  // Empty → fail.
  let r = await win.evaluate(() => window.__studioScaleSelectedVerts(2));
  expect(r.ok).toBe(false);

  // Select a face (3 verts). Record verts. Scale x2 around centroid →
  // each vert moves further from centroid by 2x.
  const before = await win.evaluate(() => {
    window.__studioReplaceEditSelection('face', 0);
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    const idx = m.geometry.index.array;
    const a = idx[0], b = idx[1], c = idx[2];
    return {
      a: [p.getX(a), p.getY(a), p.getZ(a)],
      b: [p.getX(b), p.getY(b), p.getZ(b)],
      c: [p.getX(c), p.getY(c), p.getZ(c)],
      idx: [a, b, c],
    };
  });
  r = await win.evaluate(() => window.__studioScaleSelectedVerts(2));
  expect(r.ok).toBe(true);
  expect(r.vertCount).toBe(3);

  // Each vert should be twice the original distance from centroid.
  const cx = (before.a[0] + before.b[0] + before.c[0]) / 3;
  const cy = (before.a[1] + before.b[1] + before.c[1]) / 3;
  const cz = (before.a[2] + before.b[2] + before.c[2]) / 3;
  const after = await win.evaluate((i) => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    return [p.getX(i[0]), p.getY(i[0]), p.getZ(i[0])];
  }, before.idx);
  const expX = cx + (before.a[0] - cx) * 2;
  const expY = cy + (before.a[1] - cy) * 2;
  const expZ = cz + (before.a[2] - cz) * 2;
  expect(Math.abs(after[0] - expX)).toBeLessThan(1e-5);
  expect(Math.abs(after[1] - expY)).toBeLessThan(1e-5);
  expect(Math.abs(after[2] - expZ)).toBeLessThan(1e-5);

  // factor=1 is a no-op (within float epsilon).
  await win.evaluate(() => window.__studioScaleSelectedVerts(1));
  const after2 = await win.evaluate((i) => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    return [p.getX(i[0]), p.getY(i[0]), p.getZ(i[0])];
  }, before.idx);
  expect(Math.abs(after2[0] - after[0])).toBeLessThan(1e-6);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 384: scaled 3 verts ×2 around centroid');

  await app.close();
});
