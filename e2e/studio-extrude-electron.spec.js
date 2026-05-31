import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-extrude');

test('Studio — __studioExtrudeSelectedFaces extrudes face by normal (slice 388)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioExtrudeSelectedFaces === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0, 0, 0); m.scale.set(1, 1, 1); m.updateMatrixWorld(true);
    window.__studioClearEditSelection();
  });

  // Pre-extrude counts.
  const before = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return {
      v: m.geometry.attributes.position.count,
      t: Math.floor(m.geometry.index.array.length / 3),
    };
  });
  expect(before.v).toBe(24);
  expect(before.t).toBe(12);

  // No selection → fail.
  let r = await win.evaluate(() => window.__studioExtrudeSelectedFaces(0.01));
  expect(r.ok).toBe(false);

  // Select face 0, extrude by 0.01 m.
  await win.evaluate(() => window.__studioReplaceEditSelection('face', 0));
  r = await win.evaluate(() => window.__studioExtrudeSelectedFaces(0.01));
  expect(r.ok).toBe(true);

  // Extrude adds 7 tris (1 cap + 6 walls) and 3 verts per face.
  // 24 + 3 = 27 verts; 12 - 1 + 7 = 18 tris.
  expect(r.vertCount).toBe(27);
  expect(r.triCount).toBe(18);
  expect(r.addedTris).toBe(7);

  // Extrude clears the selection.
  const sel = await win.evaluate(() => window.__studioGetEditSelection());
  expect(sel.faces.length).toBe(0);

  // Bad arg.
  await win.evaluate(() => window.__studioReplaceEditSelection('face', 0));
  const bad = await win.evaluate(() => window.__studioExtrudeSelectedFaces('xxx'));
  expect(bad.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 388: cube extruded face 0 — 24→27 verts, 12→18 tris');

  await app.close();
});
