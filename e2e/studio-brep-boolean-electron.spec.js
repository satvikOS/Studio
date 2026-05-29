import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — SOLID B-REP BOOLEAN via OCCT (headed Electron).
 *
 * The real exact NURBS-trimmed solid boolean (Rhino / Maya / Plasticity /
 * SolidWorks) via the OCCT kernel, lazy-loaded so the main bundle stays small.
 * The discriminating proof of a TRUE solid B-rep cut (vs a mesh CSG): the
 * box-minus-cylinder result has 7 topological FACES — the 6 box faces plus a
 * SEVENTH face that is the cylindrical inner wall of the through-hole. A plain
 * box has 6; a mesh CSG wouldn't carry topology at all.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-brep-boolean');

test('Studio — OCCT solid B-rep cut: 7 topological faces (through-hole)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioBRepBoolean === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  // ── cut: box minus cylinder (first call lazily loads the 50 MB OCCT WASM) ──
  const cut = await win.evaluate(async () => await window.__studioBRepBoolean({ op: 'cut' }));
  expect(cut.error, 'OCCT cut ran without error').toBeFalsy();
  expect(cut.op, 'op recorded').toBe('cut');
  expect(cut.faces, 'box - cylinder = 6 box faces + 1 cylindrical inner wall = 7').toBe(7);
  expect(cut.tris, 'tessellation produced triangles').toBeGreaterThan(60);
  expect(cut.verts, 'tessellation produced vertices').toBeGreaterThan(60);

  // confirm the primitive is in the scene with the same topology
  const inScene = await win.evaluate(() => {
    const s = window.__archdiscScene; let m = null;
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'brep-boolean') m = o; });
    return m ? { ...m.userData.archdiscBRep, gVerts: m.geometry.attributes.position.count, gIdx: m.geometry.index.count } : null;
  });
  expect(inScene, 'brep-boolean primitive in scene').not.toBeNull();
  expect(inScene.faces, 'scene mesh carries the B-rep face count').toBe(7);
  expect(inScene.gIdx, 'scene index buffer has the cut triangles').toBe(cut.tris * 3);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(20, 22, 1.45); });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-brep-cut.png') });

  // ── fuse: box + cylinder yields more faces than a plain box ──
  const fused = await win.evaluate(async () => await window.__studioBRepBoolean({ op: 'fuse' }));
  expect(fused.error, 'OCCT fuse ran without error').toBeFalsy();
  expect(fused.op, 'fuse op recorded').toBe('fuse');
  expect(fused.faces, 'fused topology has more than 6 faces').toBeGreaterThan(6);
  expect(fused.tris, 'fused tessellation produced triangles').toBeGreaterThan(60);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(22, 22, 1.4); });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '02-brep-fuse.png') });

  // eslint-disable-next-line no-console
  console.log(`  brep: cut faces=${cut.faces} tris=${cut.tris} verts=${cut.verts}; fuse faces=${fused.faces} tris=${fused.tris}`);

  await app.close();
});
