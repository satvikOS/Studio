import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 7 — Material editor for the selected mesh.
 *
 * After picking a Studio primitive (slice 6), the right panel grows a
 * Material section with a color picker, metalness / roughness / emissive
 * sliders, and a wireframe toggle. Every control live-edits the actual
 * three.js MeshStandardMaterial on the selected mesh, so the viewport
 * reflects edits immediately.
 *
 * Spec drives every control through real input events and verifies both
 * the panel readouts AND the mesh material itself via scene introspection
 * (win.evaluate reads window.__archdiscScene).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-material-editor');

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

async function selectedMaterialState(win) {
  return await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let target = null;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive && o.userData.__selectedForTest !== false) {
        target = o; // any primitive; specific mesh resolved below
      }
    });
    return null; // see specific mesh resolver in caller
  });
}

test('Studio material editor — color, metalness, roughness, emissive, wireframe', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 350,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- Add a sphere (smooth shading shows material differences best) ----
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(400);
  // Click the sphere → selected
  const spherePos = await screenPosOfMesh(win, 0);
  expect(spherePos).not.toBeNull();
  await win.mouse.click(spherePos.x, spherePos.y);
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-section="material"]')).toBeVisible({ timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '00-selected-default-material.png'), fullPage: false });

  // Helper that reads the selected mesh's actual three.js material state.
  const readMat = async () => await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let mesh = null;
    vp.scene.traverse(o => {
      if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) mesh = o;
    });
    if (!mesh) return null;
    const m = mesh.material;
    return {
      hex: '#' + m.color.getHexString(),
      metalness: m.metalness,
      roughness: m.roughness,
      emissiveIntensity: m.emissiveIntensity,
      wireframe: !!m.wireframe,
    };
  });

  // ---- Color edit: pick a vivid orange ----
  await win.locator('[data-studio-material="color"]').fill('#ff8c1a');
  await win.waitForTimeout(300);
  let s = await readMat();
  expect(s.hex.toLowerCase()).toBe('#ff8c1a');
  await win.screenshot({ path: path.join(OUT, '01-color-orange.png'), fullPage: false });

  // ---- Metalness → 0.95 (chrome-like) ----
  await win.locator('[data-studio-material="metalness"]').fill('0.95');
  await win.dispatchEvent('[data-studio-material="metalness"]', 'input');
  await win.waitForTimeout(300);
  s = await readMat();
  expect(s.metalness).toBeCloseTo(0.95, 2);
  await expect(win.locator('[data-studio-material-readout="metalness"]')).toHaveText('0.95');
  await win.screenshot({ path: path.join(OUT, '02-metalness-high.png'), fullPage: false });

  // ---- Roughness → 0.05 (mirror-like) ----
  await win.locator('[data-studio-material="roughness"]').fill('0.05');
  await win.dispatchEvent('[data-studio-material="roughness"]', 'input');
  await win.waitForTimeout(300);
  s = await readMat();
  expect(s.roughness).toBeCloseTo(0.05, 2);
  await expect(win.locator('[data-studio-material-readout="roughness"]')).toHaveText('0.05');
  await win.screenshot({ path: path.join(OUT, '03-roughness-mirror.png'), fullPage: false });

  // ---- Emissive → 0.6 (glowing) ----
  await win.locator('[data-studio-material="emissive"]').fill('0.6');
  await win.dispatchEvent('[data-studio-material="emissive"]', 'input');
  await win.waitForTimeout(300);
  s = await readMat();
  expect(s.emissiveIntensity).toBeCloseTo(0.6, 2);
  await expect(win.locator('[data-studio-material-readout="emissive"]')).toHaveText('0.60');
  await win.screenshot({ path: path.join(OUT, '04-emissive-glow.png'), fullPage: false });

  // ---- Wireframe ON ----
  await win.locator('[data-studio-material="wireframe"]').check();
  await win.waitForTimeout(300);
  s = await readMat();
  expect(s.wireframe).toBe(true);
  await win.screenshot({ path: path.join(OUT, '05-wireframe-on.png'), fullPage: false });

  // ---- Wireframe OFF ----
  await win.locator('[data-studio-material="wireframe"]').uncheck();
  await win.waitForTimeout(300);
  s = await readMat();
  expect(s.wireframe).toBe(false);
  await win.screenshot({ path: path.join(OUT, '06-wireframe-off.png'), fullPage: false });

  // ---- Tight crop on the Material panel for the headline shot ----
  const matPanelBox = await win.locator('[data-studio-section="material"]').boundingBox();
  if (matPanelBox) {
    await win.screenshot({
      path: path.join(OUT, '07-material-panel-crop.png'),
      clip: matPanelBox,
    });
  }

  // eslint-disable-next-line no-console
  console.log('  material workflow: select → color #ff8c1a → metal 0.95 → rough 0.05 → emissive 0.6 → wireframe on/off');

  await app.close();
});
