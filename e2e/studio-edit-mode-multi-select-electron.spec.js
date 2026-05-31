import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-edit-mode-multi');

test('Studio — edit-mode multi-select via additive picks (slice 381)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioAddToEditSelection === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  // Spawn cube.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0, 0, 0); m.scale.set(1, 1, 1); m.updateMatrixWorld(true);
  });

  // Programmatic add: 3 vertices.
  await win.evaluate(() => {
    window.__studioReplaceEditSelection('vertex', 0);
    window.__studioAddToEditSelection('vertex', 5);
    window.__studioAddToEditSelection('vertex', 12);
  });
  let sel = await win.evaluate(() => window.__studioGetEditSelection());
  expect(sel.vertices.length).toBe(3);
  expect(sel.vertices.includes(0)).toBe(true);
  expect(sel.vertices.includes(5)).toBe(true);
  expect(sel.vertices.includes(12)).toBe(true);

  // Dedup: re-adding same vert is no-op.
  await win.evaluate(() => window.__studioAddToEditSelection('vertex', 5));
  sel = await win.evaluate(() => window.__studioGetEditSelection());
  expect(sel.vertices.length).toBe(3);

  // Replace: single new vert, set drops to 1.
  await win.evaluate(() => window.__studioReplaceEditSelection('vertex', 7));
  sel = await win.evaluate(() => window.__studioGetEditSelection());
  expect(sel.vertices.length).toBe(1);
  expect(sel.vertices[0]).toBe(7);

  // Multi-mode: edges + faces independent.
  await win.evaluate(() => {
    window.__studioReplaceEditSelection('edge', [0, 1]);
    window.__studioAddToEditSelection('edge', [3, 4]);
    window.__studioAddToEditSelection('face', 2);
    window.__studioAddToEditSelection('face', 5);
  });
  sel = await win.evaluate(() => window.__studioGetEditSelection());
  expect(sel.edges.length).toBe(2);
  expect(sel.faces.length).toBe(2);

  // Render markers picks them up — count them in scene.
  await win.evaluate(() => window.__studioRenderEditSelectionMarkers());
  await win.waitForTimeout(150);
  const markerN = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.name === '__studio_pick_marker__') n++; });
    return n;
  });
  // 0 verts (the replace('edge') wiped them) + 2 edges + 2 faces = 4.
  expect(markerN).toBe(4);

  // Now add a vert via plain (non-replacing) add → 5 markers.
  await win.evaluate(() => window.__studioAddToEditSelection('vertex', 0));
  await win.evaluate(() => window.__studioRenderEditSelectionMarkers());
  await win.waitForTimeout(150);
  const markerN2 = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.name === '__studio_pick_marker__') n++; });
    return n;
  });
  expect(markerN2).toBe(5);

  // Mode change to object clears the set.
  await win.evaluate(() => window.__studioSetEditMode('object'));
  await win.waitForTimeout(150);
  sel = await win.evaluate(() => window.__studioGetEditSelection());
  expect(sel.vertices.length).toBe(0);
  expect(sel.edges.length).toBe(0);
  expect(sel.faces.length).toBe(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 381: multi-vert/edge/face select + dedup + replace + clear-on-object');

  await app.close();
});
