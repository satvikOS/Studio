import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-inset');

test('Studio — __studioInsetSelectedFaces creates inset cap + walls (slice 389)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioInsetSelectedFaces === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0, 0, 0); m.scale.set(1, 1, 1); m.updateMatrixWorld(true);
    window.__studioClearEditSelection();
  });

  // Bad factor.
  await win.evaluate(() => window.__studioReplaceEditSelection('face', 0));
  for (const bad of [-0.1, 0, 1, 2, 'abc']) {
    const r = await win.evaluate((f) => window.__studioInsetSelectedFaces(f), bad);
    expect(r.ok).toBe(false);
  }

  // Empty selection.
  await win.evaluate(() => window.__studioClearEditSelection());
  let r = await win.evaluate(() => window.__studioInsetSelectedFaces(0.3));
  expect(r.ok).toBe(false);

  // Real inset.
  await win.evaluate(() => window.__studioReplaceEditSelection('face', 0));
  r = await win.evaluate(() => window.__studioInsetSelectedFaces(0.3));
  expect(r.ok).toBe(true);
  expect(r.factor).toBe(0.3);
  // Same growth shape as extrude: +3 verts, +6 tris net (7 new - 1 removed).
  expect(r.vertCount).toBe(27);
  expect(r.triCount).toBe(18);

  // New verts should be CLOSER to the centroid of the original face than
  // the originals were (inset).
  const probe = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    // After inset the original face 0 verts are still there at idx 0..23.
    // The 3 inset verts are appended at 24..26.
    const orig = [0, 1, 2].map((i) => [p.getX(i), p.getY(i), p.getZ(i)]);
    const inset = [24, 25, 26].map((i) => [p.getX(i), p.getY(i), p.getZ(i)]);
    const cx = (orig[0][0] + orig[1][0] + orig[2][0]) / 3;
    const cy = (orig[0][1] + orig[1][1] + orig[2][1]) / 3;
    const cz = (orig[0][2] + orig[1][2] + orig[2][2]) / 3;
    const dist = (v) => Math.hypot(v[0] - cx, v[1] - cy, v[2] - cz);
    return { origDist: orig.map(dist), insetDist: inset.map(dist) };
  });
  for (let i = 0; i < 3; i++) {
    expect(probe.insetDist[i]).toBeLessThan(probe.origDist[i]);
  }

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 389: inset cap inside face 0 — 3 new verts closer to centroid');

  await app.close();
});
