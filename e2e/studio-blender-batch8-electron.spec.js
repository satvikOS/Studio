import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 91 — Blender mesh/UV/paint batch:
 *   Loop Cut       <- editmesh_loopcut.cc
 *   Bisect         <- editmesh_bisect.cc
 *   Bridge Edges   <- editmesh_bridge.cc
 *   Mark Seam      <- editmesh_seam.cc
 *   Separate       <- editmesh_separate.cc
 *   Smart UV       <- editmesh_uv.cc (smart_project)
 *   Vertex Paint   <- sculpt_paint/sculpt_paint_color.cc
 *   Weight Paint   <- sculpt_paint/paint_weight.cc
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-batch8');

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

test('Studio Blender batch 8 — 8 mesh/UV/paint ops', async () => {
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

  // Suzanne is a good test mesh — has structure for bisect, UVs to paint,
  // bounding sphere for bridge/separation.
  await win.locator('[data-studio-primitive="suzanne"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'suzanne');
  await win.waitForTimeout(300);

  // ---- Modeling tab ops ----
  await win.locator('[data-studio-ribbon-action="loop-cut"]').click();
  await win.waitForTimeout(300);
  expect(await meshCounter(win, 'suzanne', 'archdiscStudioLoopCut')).toBe(1);

  await win.locator('[data-studio-ribbon-action="bisect"]').click();
  await win.waitForTimeout(300);
  expect(await meshCounter(win, 'suzanne', 'archdiscStudioBisected')).toBe(1);
  await win.screenshot({ path: path.join(OUT, '01-after-loop-cut-bisect.png'), fullPage: false });

  await win.locator('[data-studio-ribbon-action="bridge-edges"]').click();
  await win.waitForTimeout(400);
  expect(await meshCounter(win, 'suzanne', 'archdiscStudioBridged')).toBe(1);
  // Bridge should spawn a new "bridge" primitive.
  const bridgeCount = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let n = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'bridge') n++; });
    return n;
  });
  expect(bridgeCount).toBe(1);

  await win.locator('[data-studio-ribbon-action="mark-seam"]').click();
  await win.waitForTimeout(200);
  expect(await meshCounter(win, 'suzanne', 'archdiscStudioSeamMarked')).toBe(1);

  await win.locator('[data-studio-ribbon-action="separate"]').click();
  await win.waitForTimeout(400);
  expect(await meshCounter(win, 'suzanne', 'archdiscStudioSeparated')).toBe(1);
  const sepCount = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let n = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'suzanne-sep') n++; });
    return n;
  });
  expect(sepCount).toBe(1);
  await win.screenshot({ path: path.join(OUT, '02-after-bridge-separate.png'), fullPage: false });

  // ---- UV/Texture tab ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="uv-texture"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="smart-uv"]').click();
  await win.waitForTimeout(300);
  expect(await meshCounter(win, 'suzanne', 'archdiscStudioSmartUv')).toBe(1);

  // ---- Sculpting tab ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="sculpting"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="vertex-paint"]').click();
  await win.waitForTimeout(300);
  expect(await meshCounter(win, 'suzanne', 'archdiscStudioVertexPainted')).toBe(1);
  await win.locator('[data-studio-ribbon-action="weight-paint"]').click();
  await win.waitForTimeout(300);
  expect(await meshCounter(win, 'suzanne', 'archdiscStudioWeightPainted')).toBe(1);
  await win.screenshot({ path: path.join(OUT, '03-after-paint.png'), fullPage: false });

  // 4-angle showcase.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `04-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender batch 8: 8 ops fired (loop-cut + bisect + bridge + mark-seam + separate + smart-uv + vertex-paint + weight-paint)`);

  await app.close();
});
