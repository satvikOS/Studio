import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 80 — Stretch + Inset Faces.
 *
 *   Stretch <- blender/source/blender/modifiers/intern/MOD_simpledeform.cc
 *              (MOD_SIMPLEDEFORM_MODE_STRETCH). Volume-preserving
 *              Y elongation: scale Y by `factor`, XZ by 1/sqrt(factor).
 *   Inset   <- blender/source/blender/editors/mesh/editmesh_inset.cc
 *              (edit-mesh operator, not a modifier). Shrink each
 *              face toward its centroid.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-stretch-inset');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function meshState(win, kind) {
  return await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (!m) return null;
    // Force fresh boundingBox compute every time — the cached one
    // doesn't auto-invalidate when positions mutate.
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    return {
      verts: m.geometry.attributes.position.count,
      indexed: !!m.geometry.index,
      heightY: bb.max.y - bb.min.y,
      widthX:  bb.max.x - bb.min.x,
      stretched: m.userData.archdiscStudioStretched || 0,
      inset:     m.userData.archdiscStudioInset || 0,
    };
  }, kind);
}

test('Studio Blender Stretch + Inset — both ribbon mods fire', async () => {
  test.setTimeout(120000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 220,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- STRETCH on a sphere — Y should grow, XZ should shrink. ----
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);
  const sphBaseline = await meshState(win, 'sphere');
  await win.locator('[data-studio-ribbon-action="stretch"]').click();
  await win.waitForTimeout(400);
  const afterStretch = await meshState(win, 'sphere');
  expect(afterStretch.stretched).toBe(1);
  expect(afterStretch.heightY).toBeGreaterThan(sphBaseline.heightY);  // taller
  expect(afterStretch.widthX).toBeLessThan(sphBaseline.widthX);       // narrower
  await win.screenshot({ path: path.join(OUT, '01-sphere-stretched.png'), fullPage: false });

  // ---- INSET on an icosahedron — verts should multiply (toNonIndexed). ----
  await win.locator('[data-studio-action="clear-scene-ribbon"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="icosahedron"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'icosahedron');
  await win.waitForTimeout(300);
  const icosaBaseline = await meshState(win, 'icosahedron');
  await win.locator('[data-studio-ribbon-action="inset"]').click();
  await win.waitForTimeout(400);
  const afterInset = await meshState(win, 'icosahedron');
  expect(afterInset.inset).toBe(1);
  expect(afterInset.indexed).toBe(false);
  await win.screenshot({ path: path.join(OUT, '02-icosa-inset.png'), fullPage: false });

  // ---- 4-angle showcase ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `03-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender stretch + inset: sphere y${sphBaseline.heightY.toFixed(4)} x${sphBaseline.widthX.toFixed(4)} -> stretched y${afterStretch.heightY.toFixed(4)} x${afterStretch.widthX.toFixed(4)}; icosa inset shows exploded panels`);

  await app.close();
});
