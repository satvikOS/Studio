import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 85 — Compositor effects + shader textures + Blender lights.
 *
 *   Compositor:
 *     bloom / vignette / pixelate / lens / chr-ab
 *     <- compositor/operations/COM_*.cc
 *   Shader textures:
 *     voronoi / wave / brick / magic
 *     <- nodes/shader/node_shader_tex_*.cc
 *   Lights:
 *     point / sun / spot / area
 *     <- blenkernel/light.cc
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-comp-shader-lights');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

test('Studio Blender suite — compositor + shader textures + light types', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 150,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- SHADER TEXTURES (UV/Texture tab) ----
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="uv-texture"]').click();
  await win.waitForTimeout(300);

  const patterns = ['voronoi', 'wave', 'brick', 'magic'];
  for (const p of patterns) {
    await win.locator(`[data-studio-ribbon-action="shader-${p}"]`).click();
    await win.waitForTimeout(300);
    const stamped = await win.evaluate(() => {
      const vp = window.__archdiscViewport;
      let m = null;
      vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
      return m ? m.userData.archdiscStudioShaderTexture : null;
    });
    expect(stamped).toBe(p);
  }
  await win.screenshot({ path: path.join(OUT, '01-after-shader-textures.png'), fullPage: false });

  // ---- BLENDER LIGHTS (Rendering tab) ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rendering"]').click();
  await win.waitForTimeout(300);

  for (const type of ['point', 'sun', 'spot', 'area']) {
    await win.locator(`[data-studio-ribbon-action="light-${type}"]`).click();
    await win.waitForTimeout(250);
  }
  const lights = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const out = {};
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioLightType) {
        out[o.userData.archdiscStudioLightType] = (out[o.userData.archdiscStudioLightType] || 0) + 1;
      }
    });
    return out;
  });
  expect(lights.point).toBe(1);
  expect(lights.sun).toBe(1);
  expect(lights.spot).toBe(1);
  expect(lights.area).toBe(1);
  await win.screenshot({ path: path.join(OUT, '02-after-4-light-types.png'), fullPage: false });

  // ---- RENDER FRAME + COMPOSITOR EFFECTS ----
  // Need a render in the buffer for compositor effects to act on.
  await win.locator('[data-studio-action="render-frame"]').click();
  await win.waitForTimeout(800);
  const baselineRenders = await win.evaluate(() => {
    // Count render thumbnails (data-studio-render-thumb).
    return document.querySelectorAll('[data-studio-render-thumb]').length;
  });

  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="compositing"]').click();
  await win.waitForTimeout(300);

  for (const fx of ['bloom', 'vignette', 'pixelate', 'lens', 'chromatic']) {
    await win.locator(`[data-studio-ribbon-action="comp-${fx}"]`).click();
    await win.waitForTimeout(400);
  }
  // 5 compositor passes should have produced 5 more render thumbnails.
  const totalRenders = await win.evaluate(() => {
    return document.querySelectorAll('[data-studio-render-thumb]').length;
  });
  expect(totalRenders).toBeGreaterThanOrEqual(baselineRenders + 5);
  await win.screenshot({ path: path.join(OUT, '03-after-5-compositor-effects.png'), fullPage: false });

  // 4-angle showcase.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `04-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender comp+shader+lights: 4 shader textures (voronoi/wave/brick/magic), 4 light types (point/sun/spot/area), 5 compositor effects (bloom/vignette/pixelate/lens/chr-ab)`);

  await app.close();
});
