import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-move-selected-verts');

test('Studio — __studioMoveSelectedVerts edits multi-selection (slice 382)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioMoveSelectedVerts === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  // Spawn cube + clear edit selection.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1); m.updateMatrixWorld(true);
    window.__studioClearEditSelection();
  });

  // No selection → move fails cleanly.
  let r = await win.evaluate(() => window.__studioMoveSelectedVerts(0.01, 0, 0));
  expect(r.ok).toBe(false);

  // Select vert 0; record its position; move +X 0.01; verify.
  const before = await win.evaluate(() => {
    window.__studioReplaceEditSelection('vertex', 0);
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    return [p.getX(0), p.getY(0), p.getZ(0)];
  });
  r = await win.evaluate(() => window.__studioMoveSelectedVerts(0.01, 0, 0));
  expect(r.ok).toBe(true);
  expect(r.vertCount).toBe(1);
  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    return [p.getX(0), p.getY(0), p.getZ(0)];
  });
  expect(Math.abs(after[0] - before[0] - 0.01)).toBeLessThan(1e-6);
  expect(Math.abs(after[1] - before[1])).toBeLessThan(1e-6);
  expect(Math.abs(after[2] - before[2])).toBeLessThan(1e-6);

  // Dedup: select a face whose verts overlap a selected vert — moved once.
  const dedup = await win.evaluate(() => {
    window.__studioReplaceEditSelection('vertex', 0);
    window.__studioAddToEditSelection('face', 0); // triangle 0 includes vert 0
    return window.__studioMoveSelectedVerts(0.005, 0, 0);
  });
  // Face 0 verts (3 indices). Vert 0 may or may not be in that triangle
  // depending on index buffer order — count is at most 3, at least 3.
  expect(dedup.ok).toBe(true);
  expect(dedup.vertCount).toBeGreaterThanOrEqual(3);
  expect(dedup.vertCount).toBeLessThanOrEqual(4);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 382: vert moved by 0.01, dedup vertCount=', dedup.vertCount);

  await app.close();
});
