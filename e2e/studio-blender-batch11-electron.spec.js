import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 102 — Blender mesh-edit batch 11.
 *
 *   Mark Sharp     <- editmesh_sharp.cc
 *   Clear Sharp    <- editmesh_sharp.cc
 *   Mark Crease    <- editmesh_crease.cc
 *   Loop Select    <- editmesh_loopcut.cc
 *   Edge Ring Sel  <- editmesh_select_walk.cc
 *   Select All     <- editmesh_select_all.cc (A)
 *   Invert Sel     <- editmesh_select_all.cc (Ctrl+I)
 *   Symmetrize     <- editmesh_symmetrize.cc
 *   Fill Holes     <- editmesh_fill.cc
 *   Beauty Faces   <- editmesh_beauty.cc
 *   Origin→CoM     <- object_set_origin.cc
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-batch11');

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

test('Studio Blender batch 11 — 11 more mesh-edit / select ops', async () => {
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
    ['mark-sharp',    'archdiscStudioSharpMarked'],
    ['clear-sharp',   'archdiscStudioSharpCleared'],
    ['mark-crease',   'archdiscStudioCreaseMarked'],
    ['loop-select',   'archdiscStudioLoopSelect'],
    ['ring-select',   'archdiscStudioEdgeRingSelect'],
    ['select-all',    'archdiscStudioSelectAll'],
    ['invert-sel',    'archdiscStudioInvertedSel'],
    ['symmetrize',    'archdiscStudioSymmetrized'],
    ['fill-holes',    'archdiscStudioFilled'],
    ['beauty-faces',  'archdiscStudioBeauty'],
    ['origin-com',    'archdiscStudioOriginCoM'],
  ];
  for (const [action, key] of ops) {
    await win.locator(`[data-studio-ribbon-action="${action}"]`).click();
    await win.waitForTimeout(220);
    const counter = await meshCounter(win, 'sphere', key);
    expect(counter, `op ${action}`).toBeGreaterThan(0);
  }
  await win.screenshot({ path: path.join(OUT, '01-after-11-ops.png'), fullPage: false });

  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `02-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender batch 11: 11 ops fired (mark-sharp + clr-sharp + crease + loop-sel + ring-sel + sel-all + invert + symmetry + fill + beauty + origin-CoM)`);

  await app.close();
});
