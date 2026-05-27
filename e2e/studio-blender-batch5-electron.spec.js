import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 86 — Geometry nodes (more) + Bake ops + Particle presets +
 * World shading.
 *
 *   Geometry Nodes (4 more):
 *     Set Position, BBox Geo, Transform Geo (in addition to S84's 4)
 *   Bake (3): AO / Normals / Position
 *   Particle presets (3): Fire / Smoke / Sparkle
 *   World (3): HDRI sky / Solid / Fog
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-batch5');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

test('Studio Blender batch 5 — geometry nodes + bake + particles + world', async () => {
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

  // ---- GEOMETRY NODES (Modeling tab) ----
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);

  await win.locator('[data-studio-ribbon-action="gn-set-pos"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="gn-bbox"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="gn-transform"]').click();
  await win.waitForTimeout(300);

  const gnState = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    return {
      setPos: m ? m.userData.archdiscStudioGnSetPosition : 0,
      bbox:   m ? m.userData.archdiscStudioGnBoundingBox : 0,
      xform:  m ? m.userData.archdiscStudioGnTransform : 0,
    };
  });
  expect(gnState.setPos).toBe(1);
  expect(gnState.bbox).toBe(1);
  expect(gnState.xform).toBe(1);

  // ---- BAKE OPS ----
  for (const target of ['ao', 'normals', 'position']) {
    await win.locator(`[data-studio-ribbon-action="bake-${target}"]`).click();
    await win.waitForTimeout(250);
    const baked = await win.evaluate(() => {
      const vp = window.__archdiscViewport;
      let m = null;
      vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
      return m ? m.userData.archdiscStudioBaked : null;
    });
    expect(baked).toBe(target);
  }
  await win.screenshot({ path: path.join(OUT, '01-after-bake.png'), fullPage: false });

  // ---- PARTICLE PRESETS (VFX/Sim tab) ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="vfx-sim"]').click();
  await win.waitForTimeout(300);

  for (const preset of ['fire', 'smoke', 'sparkle']) {
    await win.locator(`[data-studio-ribbon-action="preset-${preset}"]`).click();
    await win.waitForTimeout(300);
  }
  const presetCounts = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const counts = {};
    vp.scene.traverse(o => {
      const k = o.userData && o.userData.archdiscStudioPrimitiveKind;
      if (k && k.startsWith('particle-')) counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
  });
  expect(presetCounts['particle-fire']).toBe(1);
  expect(presetCounts['particle-smoke']).toBe(1);
  expect(presetCounts['particle-sparkle']).toBe(1);
  await win.screenshot({ path: path.join(OUT, '02-after-particles.png'), fullPage: false });

  // ---- WORLD SHADING (Rendering tab) ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rendering"]').click();
  await win.waitForTimeout(300);

  for (const mode of ['hdri', 'solid', 'fog']) {
    await win.locator(`[data-studio-ribbon-action="world-${mode}"]`).click();
    await win.waitForTimeout(250);
  }
  const worldMode = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    return vp.scene.userData && vp.scene.userData.archdiscStudioWorldShading;
  });
  expect(worldMode).toBe('fog');  // final mode set
  await win.screenshot({ path: path.join(OUT, '03-world-fog.png'), fullPage: false });

  // 4-angle showcase.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `04-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender batch 5: 3 GN ops + 3 bakes + 3 particle presets + 3 world modes = 12 tools`);

  await app.close();
});
