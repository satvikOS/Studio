import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 104 — Blender batch 12: curves + modifier stack + snap + sequencer.
 *
 *   Bezier curve     <- editcurve_add.cc
 *   NURBS path       <- editcurve_add.cc
 *   Draw curve       <- editcurve_paint.cc
 *   Curve resolution <- BKE_curve_calc
 *   Apply mod stack  <- object_modifier.cc
 *   Mod up/down      <- object_modifier.cc
 *   Hide / Reveal    <- object_hide.cc
 *   Lock transform   <- object_constraint.cc
 *   Snap to cursor   <- view3d_cursor.cc
 *   Cursor to sel    <- view3d_cursor.cc
 *   Snap mode        <- transform_snap.cc
 *   Seq image        <- sequencer_edit.cc
 *   GP layer         <- grease_pencil_*.cc
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-batch12');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

test('Studio Blender batch 12 — 13 curve / modifier-stack / snap / sequencer ops', async () => {
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

  // ---- New curve primitives ----
  await win.locator('[data-studio-ribbon-action="add-bezier"]').click();
  await win.waitForTimeout(400);
  await win.locator('[data-studio-ribbon-action="add-nurbs-path"]').click();
  await win.waitForTimeout(400);

  const curveCounts = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let bz = 0, np = 0;
    vp.scene.traverse(o => {
      const k = o.userData && o.userData.archdiscStudioPrimitiveKind;
      if (k === 'bezier-curve') bz++;
      else if (k === 'nurbs-path') np++;
    });
    return { bz, np };
  });
  expect(curveCounts.bz).toBe(1);
  expect(curveCounts.np).toBe(1);
  await win.screenshot({ path: path.join(OUT, '01-curves.png'), fullPage: false });

  // ---- Stage a sphere for the rest ----
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(280);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(280);

  // ---- Sequential ops on the sphere ----
  const counterChecks = [
    ['draw-curve',      'archdiscStudioDrawCurve'],
    ['curve-res',       'archdiscStudioCurveResolution'],
    ['apply-mod-stack', 'archdiscStudioModifierStackApplied'],
    ['mod-up',          'archdiscStudioMoveModUp'],
    ['mod-down',        'archdiscStudioMoveModDown'],
    ['lock-xform',      'archdiscStudioLockedTransform'],
    ['snap-cursor',     'archdiscStudioSnappedToCursor'],
    ['cursor-sel',      'archdiscStudioCursorToSel'],
  ];
  for (const [action, key] of counterChecks) {
    await win.locator(`[data-studio-ribbon-action="${action}"]`).click();
    await win.waitForTimeout(220);
    const counter = await win.evaluate((ck) => {
      const vp = window.__archdiscViewport;
      let m = null;
      vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
      return m ? m.userData[ck] : null;
    }, key);
    expect(counter, `op ${action}`).toBeTruthy();
  }

  // ---- Hide selected -> sphere becomes invisible ----
  await win.locator('[data-studio-ribbon-action="hide-sel"]').click();
  await win.waitForTimeout(300);
  const visAfterHide = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    return m ? m.visible : null;
  });
  expect(visAfterHide).toBe(false);

  // Reveal All -> sphere visible again.
  await win.locator('[data-studio-ribbon-action="reveal-all"]').click();
  await win.waitForTimeout(300);
  const visAfterReveal = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    return m ? m.visible : null;
  });
  expect(visAfterReveal).toBe(true);

  // ---- Scene-userData ops ----
  await win.locator('[data-studio-ribbon-action="snap-mode"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-ribbon-action="seq-image"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-ribbon-action="gpencil-layer"]').click();
  await win.waitForTimeout(200);

  const sceneUd = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const ud = vp.scene.userData || {};
    return {
      snapMode: ud.archdiscStudioSnapMode,
      imageStrips: ud.archdiscStudioImageStrips,
      gpLayers: ud.archdiscStudioGreasePencilLayers,
    };
  });
  expect(sceneUd.snapMode).toBe('vertex');
  expect(sceneUd.imageStrips).toBe(1);
  expect(sceneUd.gpLayers).toBe(1);
  await win.screenshot({ path: path.join(OUT, '02-after-batch12.png'), fullPage: false });

  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `03-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender batch 12: 13 ops (bezier + nurbs + draw + curve-res + apply-stk + mod-up/dn + lock + snap-cur + cur-sel + hide/reveal + snap-mode + seq-img + gp-layer)`);

  await app.close();
});
