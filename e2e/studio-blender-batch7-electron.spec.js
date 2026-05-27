import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 89 — Big batch grounded in video survey:
 *
 *   Soft Body          <- MOD_softbody.cc           (Video-684 modifier search)
 *   Coll Surface       <- MOD_surface.cc            (Video-684)
 *   Repeat Last        <- screen_edit.cc            (Video-670 Edit menu)
 *   Command Palette    <- F3 menu_search            (Video-670)
 *   Pose Mode          <- editors/armature/pose_*.cc (Video-779 face rig)
 *   IK Solver          <- constraint.cc CONSTRAINT_TYPE_KINEMATIC
 *   Bezier easing      <- rna_animation.c           (Video-850 curve editor)
 *   View shading       <- view3d_shading.cc
 *   Noise Texture      <- node_shader_tex_noise.cc  (Video-395 GN graph)
 *   Color Ramp         <- node_shader_valToRgb.cc   (Video-395)
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-batch7');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

test('Studio Blender batch 7 — soft body + pose + IK + shading + ramp', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 120,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Stage sphere — used as the subject for soft body / collision /
  // shader textures.
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);

  // ---- Soft Body + Collision Surface (Modeling tab) ----
  await win.locator('[data-studio-ribbon-action="softbody"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="surface-collision"]').click();
  await win.waitForTimeout(300);
  const softState = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    return {
      soft: m ? m.userData.archdiscStudioSoftBody : 0,
      coll: m ? m.userData.archdiscStudioCollisionSurface : false,
    };
  });
  expect(softState.soft).toBe(1);
  expect(softState.coll).toBe(true);

  // ---- Repeat Last ---- (counter-only verification)
  await win.locator('[data-studio-ribbon-action="repeat-last"]').click();
  await win.waitForTimeout(200);

  // ---- Command Palette (F3) ----
  await win.locator('[data-studio-ribbon-action="cmd-palette"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-command-palette]')).toBeVisible();
  await expect(win.locator('[data-studio-command-palette-input]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '01-command-palette.png'), fullPage: false });
  // Close with Escape.
  await win.locator('[data-studio-command-palette-input]').press('Escape');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-command-palette]')).toHaveCount(0);

  // ---- Shader textures: Noise + Color Ramp ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="uv-texture"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="shader-noise"]').click();
  await win.waitForTimeout(300);
  let stamped = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    return m ? m.userData.archdiscStudioShaderTexture : null;
  });
  expect(stamped).toBe('noise');
  await win.locator('[data-studio-ribbon-action="shader-color-ramp"]').click();
  await win.waitForTimeout(300);
  stamped = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    return m ? m.userData.archdiscStudioShaderTexture : null;
  });
  expect(stamped).toBe('color-ramp');

  // ---- Pose Mode + IK (Rigging tab) ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rigging"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="pose-mode"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-ribbon-action="ik-solver"]').click();
  await win.waitForTimeout(300);
  const rigState = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    return {
      poseToggled: m ? m.userData.archdiscStudioPoseModeToggled : 0,
      ikSolved:    m ? m.userData.archdiscStudioIkSolved : 0,
    };
  });
  expect(rigState.poseToggled).toBe(1);
  expect(rigState.ikSolved).toBe(1);

  // ---- Bezier easing (Animation tab) ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="animation"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="ease-bezier"]').click();
  await win.waitForTimeout(200);

  // ---- View Shading (Rendering tab) ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rendering"]').click();
  await win.waitForTimeout(300);
  for (const mode of ['solid', 'material', 'rendered']) {
    await win.locator(`[data-studio-ribbon-action="shade-${mode}"]`).click();
    await win.waitForTimeout(200);
  }
  const viewMode = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    return vp.scene.userData && vp.scene.userData.archdiscStudioViewShading;
  });
  expect(viewMode).toBe('rendered');

  await win.screenshot({ path: path.join(OUT, '02-final.png'), fullPage: false });

  // 4-angle showcase.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `03-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender batch 7: 10 ops fired (softbody + collision + repeat-last + cmd palette + pose + IK + noise + color ramp + bezier easing + view shading)`);

  await app.close();
});
