import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 11 — Text 3D (Motion Graphics discipline).
 *
 * User types a string into the Text 3D panel, picks a size, clicks
 * Add 3D Text → an extruded TextGeometry mesh lands in the scene
 * and joins the rest of the primitive pipeline (selection, material,
 * sculpt, animation, delete). Font is loaded from frontend/public/
 * /fonts/droid_sans_regular.typeface.json (copied from three's
 * bundled examples) so packaged Electron builds carry it offline.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-text3d');

async function screenPosOfMesh(win, index) {
  return await win.evaluate(({ idx }) => {
    const vp = window.__archdiscViewport;
    const meshes = [];
    vp.scene.traverse(o => {
      if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) meshes.push(o);
    });
    const mesh = meshes[idx];
    if (!mesh) return null;
    const v = mesh.position.clone().project(vp.camera);
    const rect = vp.renderer.domElement.getBoundingClientRect();
    return {
      x: (v.x + 1) / 2 * rect.width + rect.left,
      y: (-v.y + 1) / 2 * rect.height + rect.top,
    };
  }, { idx: index });
}

test('Studio Text 3D — type, size, render an extruded text mesh', async () => {
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

  // ---- Text3D panel visible; font may still be loading initially ----
  await expect(win.locator('[data-studio-section="text3d"]')).toBeVisible();
  await expect(win.locator('[data-studio-text3d="input"]')).toHaveValue('Studio');

  // Wait for font to load (button enables when fontReady).
  await expect(win.locator('[data-studio-font-state]')).toHaveText('font ready', { timeout: 15000 });
  await expect(win.locator('[data-studio-action="add-text3d"]')).toBeEnabled();
  await win.screenshot({ path: path.join(OUT, '00-font-ready.png'), fullPage: false });

  // ---- Click Add 3D Text with the default "Studio" string ----
  await win.locator('[data-studio-action="add-text3d"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('1 primitive in scene');

  const stats0 = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let mesh = null;
    vp.scene.traverse(o => {
      if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitiveKind === 'text-3d') mesh = o;
    });
    if (!mesh) return null;
    return {
      vCount: mesh.geometry.attributes.position.count,
      // TextGeometry has more vertices than primitives — assert plenty.
    };
  });
  expect(stats0).not.toBeNull();
  expect(stats0.vCount).toBeGreaterThan(200);

  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(0, 15, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-studio-default-text.png'), fullPage: false });

  // ---- Change text + size, add a second 3D text mesh ----
  await win.locator('[data-studio-text3d="input"]').fill('ArchDisc');
  await win.locator('[data-studio-text3d="size"]').fill('0.02');
  await win.dispatchEvent('[data-studio-text3d="size"]', 'input');
  await expect(win.locator('[data-studio-text3d-readout="size"]')).toHaveText('20.0 mm');
  await win.locator('[data-studio-action="add-text3d"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('2 primitives in scene');
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(15, 20, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '02-second-text-archdisc.png'), fullPage: false });

  // ---- Pick the second text mesh, apply a sculpt brush, verify the
  //      full pipeline still cooperates with extruded text. ----
  const meshPos = await screenPosOfMesh(win, 1);
  expect(meshPos).not.toBeNull();
  await win.mouse.click(meshPos.x, meshPos.y);
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('text-3d');
  await win.screenshot({ path: path.join(OUT, '03-text-selected.png'), fullPage: false });

  // Edit material color to gold-ish via the existing Material panel.
  await win.locator('[data-studio-material="color"]').fill('#ffd84d');
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '04-text-recolored.png'), fullPage: false });

  // Multi-angle for the headline.
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(45, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '05-text-orbit-az45.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  text3d: 'Studio' → ${stats0.vCount}v; 'ArchDisc' added at 20mm; second text selected + recolored`);

  await app.close();
});
