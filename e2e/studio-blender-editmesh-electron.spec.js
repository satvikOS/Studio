import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 88 — Blender editmesh operators.
 *
 * 12 more Blender-source-cited mesh-edit ops:
 *   Extrude, Spin, Flip Normals, Recalc Normals, Triangulate,
 *   Merge By Distance, Smooth-N, Origin→Geo, Snap to Grid,
 *   Clear Xform, Apply Xform, Auto Smooth
 *
 * Source: blender/source/blender/editors/mesh/editmesh_*.cc
 *       + blender/source/blender/editors/object/object_apply.cc
 *       + blender/source/blender/editors/transform/transform_snap.cc
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-editmesh');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function meshCounter(win, kind, key) {
  return await win.evaluate(({ k, ck }) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    return m ? (m.userData[ck] || 0) : 0;
  }, { k: kind, ck: key });
}

test('Studio Blender editmesh operators — 12 ops fire through ribbon', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 100,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);

  const ops = [
    ['extrude',           'archdiscStudioExtruded'],
    ['spin-y',            'archdiscStudioSpun'],
    ['flip-normals',      'archdiscStudioFlippedNormals'],
    ['recalc-normals',    'archdiscStudioRecalcNormals'],
    ['triangulate',       'archdiscStudioTriangulated'],
    ['merge-by-distance', 'archdiscStudioMergeByDistance'],
    ['smooth-n',          'archdiscStudioSmoothN'],
    ['origin-to-geo',     'archdiscStudioOriginRecentred'],
    ['snap-grid',         'archdiscStudioSnappedToGrid'],
    ['clear-xform',       'archdiscStudioClearedTransform'],
    ['apply-xform',       'archdiscStudioAppliedTransform'],
    ['auto-smooth',       'archdiscStudioAutoSmooth'],
  ];

  for (const [action, key] of ops) {
    await win.locator(`[data-studio-ribbon-action="${action}"]`).click();
    await win.waitForTimeout(250);
    const counter = await meshCounter(win, 'sphere', key);
    expect(counter, `op ${action} counter`).toBeGreaterThan(0);
  }
  await win.screenshot({ path: path.join(OUT, '01-after-12-ops.png'), fullPage: false });

  // 4-angle showcase.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `02-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender editmesh: 12 ops fired (extrude, spin, flip-n, recalc-n, triangulate, merge-d, smooth-5, origin→geo, snap-grid, clr-xform, apply-xform, auto-smooth)`);

  await app.close();
});
