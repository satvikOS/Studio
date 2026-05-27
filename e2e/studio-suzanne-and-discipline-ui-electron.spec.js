import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 30 — Suzanne (imported from vendored Blender source) + the
 * discipline-aware property-panel UI/UX overhaul.
 *
 * Two concurrent additions:
 *
 * 1. Suzanne primitive: vertex/index data verbatim from
 *    blender/tests/files/io_tests/x3d/suzanne_material.x3d, converted
 *    to a JS module by tools/import_suzanne.py. Studio's first
 *    primitive whose geometry literally comes from the vendored
 *    blender/ source. Asserted: position.count == 507 (the upstream
 *    Monkey mesh has 505 vertices but the X3D exporter pads to 507).
 *
 * 2. Discipline-aware property sections: switching the discipline
 *    ribbon-tab (Modeling / Sculpting / UV-Texture / Rigging /
 *    Animation / VFX-Sim / Rendering / Compositing) now shows only
 *    the sections relevant to that discipline. AI Prompt, Welcome,
 *    Selection, Material remain visible on every tab. Implemented
 *    via a single inline CSS block driven by data-studio-discipline
 *    on the properties aside.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-suzanne-and-discipline-ui');

test('Studio Suzanne + discipline-aware UI — Blender-imported primitive + per-tab section visibility', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 300,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- Suzanne is one of the primitive buttons ----
  await expect(win.locator('[data-studio-primitive="suzanne"]')).toBeVisible();
  await win.locator('[data-studio-primitive="suzanne"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('1 primitive in scene');

  // Vertex count comes literally from the vendored Blender X3D data.
  const suzanneVerts = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let mesh = null;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'suzanne') mesh = o;
    });
    return mesh ? mesh.geometry.attributes.position.count : 0;
  });
  expect(suzanneVerts).toBe(507);

  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(0, 10, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-suzanne-front.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(45, 15, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-suzanne-3-4-view.png'), fullPage: false });

  // ---- Discipline-aware visibility ----
  // Modeling (default) — Mesh stats + Subdivision should be visible;
  //                       Sculpting + Animation hidden.
  await expect(win.locator('[data-studio-section="mesh"]')).toBeVisible();
  await expect(win.locator('[data-studio-section="subdivision"]')).toBeVisible();
  await expect(win.locator('[data-studio-section="sculpting"]')).toBeHidden();
  await expect(win.locator('[data-studio-section="animation"]')).toBeHidden();

  // Switch to Sculpting — Sculpting + Subdivision + Mirror visible;
  //                        Mesh stats + Animation + Particles hidden.
  await win.locator('[data-studio-discipline="sculpting"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-section="sculpting"]')).toBeVisible();
  await expect(win.locator('[data-studio-section="subdivision"]')).toBeVisible();
  await expect(win.locator('[data-studio-section="mirror"]')).toBeVisible();
  await expect(win.locator('[data-studio-section="mesh"]')).toBeHidden();
  await expect(win.locator('[data-studio-section="animation"]')).toBeHidden();
  await expect(win.locator('[data-studio-section="particles"]')).toBeHidden();
  await win.screenshot({ path: path.join(OUT, '02-sculpting-tab.png'), fullPage: false });

  // Switch to Animation — Animation visible; Sculpting hidden.
  await win.locator('[data-studio-discipline="animation"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-section="animation"]')).toBeVisible();
  await expect(win.locator('[data-studio-section="sculpting"]')).toBeHidden();
  await expect(win.locator('[data-studio-section="mesh"]')).toBeHidden();
  await win.screenshot({ path: path.join(OUT, '03-animation-tab.png'), fullPage: false });

  // Switch to VFX / Sim — Particles + Physics visible; everything else hidden.
  await win.locator('[data-studio-discipline="vfx-sim"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-section="particles"]')).toBeVisible();
  await expect(win.locator('[data-studio-section="physics"]')).toBeVisible();
  await expect(win.locator('[data-studio-section="animation"]')).toBeHidden();
  await expect(win.locator('[data-studio-section="sculpting"]')).toBeHidden();
  await win.screenshot({ path: path.join(OUT, '04-vfx-tab.png'), fullPage: false });

  // Switch to Rendering — Render + Renders + Lighting visible.
  await win.locator('[data-studio-discipline="rendering"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-section="render"]')).toBeVisible();
  await expect(win.locator('[data-studio-section="renders"]')).toBeVisible();
  await expect(win.locator('[data-studio-section="lighting"]')).toBeVisible();
  await expect(win.locator('[data-studio-section="particles"]')).toBeHidden();
  await win.screenshot({ path: path.join(OUT, '05-rendering-tab.png'), fullPage: false });

  // Switch to Compositing — Compositing + Renders visible.
  await win.locator('[data-studio-discipline="compositing"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-section="compositing"]')).toBeVisible();
  await expect(win.locator('[data-studio-section="renders"]')).toBeVisible();
  await expect(win.locator('[data-studio-section="render"]')).toBeHidden();
  await win.screenshot({ path: path.join(OUT, '06-compositing-tab.png'), fullPage: false });

  // Back to Modeling — Mesh + Reference + ArchViz + Lathe etc. all visible again.
  await win.locator('[data-studio-discipline="modeling"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-section="mesh"]')).toBeVisible();
  await expect(win.locator('[data-studio-section="reference"]')).toBeVisible();
  await expect(win.locator('[data-studio-section="archviz"]')).toBeVisible();
  await expect(win.locator('[data-studio-section="sculpting"]')).toBeHidden();
  await win.screenshot({ path: path.join(OUT, '07-back-to-modeling.png'), fullPage: false });

  // ---- AI prompt can spawn a Suzanne too ("monkey" or "suzanne" keyword) ----
  await win.locator('[data-studio-ai="prompt"]').fill('add a monkey and a sphere');
  await win.locator('[data-studio-action="run-ai-prompt"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('3 primitives in scene');
  // Both kinds should be in the scene.
  const aiState = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const kinds = [];
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind) kinds.push(o.userData.archdiscStudioPrimitiveKind);
    });
    return kinds.sort();
  });
  expect(aiState).toEqual(['sphere', 'suzanne', 'suzanne']);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(0, 10, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '08-suzanne-trio-from-ai.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  suzanne: vertex count ${suzanneVerts} (from blender x3d). discipline tabs gate visible sections.`);

  await app.close();
});
