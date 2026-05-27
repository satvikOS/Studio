import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 6 — selection + transform gizmo + deletion (button + Delete key).
 *
 * Real-user workflow: launch Studio, add a few primitives, raycast-click
 * one to select it (canvas pointer event, NOT scene injection), confirm
 * the Selection property section appears with the right kind/position/
 * gizmo readouts, switch left-toolbar mode to Rotate/Scale and watch
 * the gizmo mode in the panel follow, click Delete Selected, click a
 * second primitive and remove it via the Delete key.
 *
 * Coordinates: a helper computes each mesh's screen-space position by
 * projecting its three.js world position through the camera, then
 * win.mouse.click(x, y) fires the actual pointerdown on the renderer
 * canvas — same path a human cursor takes.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-selection-gizmo');

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

test('Studio selection + gizmo — pick / mode-switch / Delete-button / Delete-key', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 350,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport && !!window.__archdiscViewport.renderer, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- Baseline: no Selection panel ----
  await expect(win.locator('[data-studio-section="selection"]')).toHaveCount(0);
  await win.screenshot({ path: path.join(OUT, '00-no-selection.png'), fullPage: false });

  // ---- Compose 3 primitives so we have something to click ----
  for (const kind of ['cube', 'sphere', 'cone']) {
    await win.locator(`[data-studio-primitive="${kind}"]`).click();
    await win.waitForTimeout(400);
  }
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('3 primitives in scene');
  await win.screenshot({ path: path.join(OUT, '01-three-primitives.png'), fullPage: false });

  // ---- Click the first primitive (cube) on the canvas ----
  const cubePos = await screenPosOfMesh(win, 0);
  expect(cubePos).not.toBeNull();
  await win.mouse.click(cubePos.x, cubePos.y);
  await win.waitForTimeout(500);

  // Selection panel appears.
  await expect(win.locator('[data-studio-section="selection"]')).toBeVisible({ timeout: 5000 });
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('cube');
  await expect(win.locator('[data-studio-selection="gizmo-mode"]')).toHaveText('translate');
  // The position readout is monospace x, y, z numerals.
  await expect(win.locator('[data-studio-selection="position"]')).toContainText(',');
  await win.screenshot({ path: path.join(OUT, '02-selected-cube-translate.png'), fullPage: false });

  // ---- Switch toolbar tool to Rotate → gizmo mode follows ----
  await win.locator('[data-studio-tool="rotate"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-selection="gizmo-mode"]')).toHaveText('rotate');
  await win.screenshot({ path: path.join(OUT, '03-rotate-mode.png'), fullPage: false });

  // ---- Switch to Scale → mode follows ----
  await win.locator('[data-studio-tool="scale"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-selection="gizmo-mode"]')).toHaveText('scale');
  await win.screenshot({ path: path.join(OUT, '04-scale-mode.png'), fullPage: false });

  // ---- Back to Move and click the SPHERE → selection switches ----
  await win.locator('[data-studio-tool="move"]').click();
  await win.waitForTimeout(300);
  const spherePos = await screenPosOfMesh(win, 1);
  expect(spherePos).not.toBeNull();
  await win.mouse.click(spherePos.x, spherePos.y);
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('sphere');
  await expect(win.locator('[data-studio-selection="gizmo-mode"]')).toHaveText('translate');
  await win.screenshot({ path: path.join(OUT, '05-selected-sphere.png'), fullPage: false });

  // ---- Delete Selected button removes the sphere ----
  await win.locator('[data-studio-action="delete-selected"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('2 primitives in scene');
  // Selection panel hides because nothing is selected.
  await expect(win.locator('[data-studio-section="selection"]')).toHaveCount(0);
  await win.screenshot({ path: path.join(OUT, '06-after-delete-selected.png'), fullPage: false });

  // ---- Click the cone (now index 1 in remaining stack: cube, cone) ----
  const conePos = await screenPosOfMesh(win, 1);
  expect(conePos).not.toBeNull();
  await win.mouse.click(conePos.x, conePos.y);
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('cone');
  await win.screenshot({ path: path.join(OUT, '07-selected-cone.png'), fullPage: false });

  // ---- Delete key (keyboard) removes the cone ----
  await win.keyboard.press('Delete');
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('1 primitive in scene');
  await expect(win.locator('[data-studio-section="selection"]')).toHaveCount(0);
  await win.screenshot({ path: path.join(OUT, '08-after-delete-key.png'), fullPage: false });

  // ---- Click empty space → no new selection appears (already nothing
  //      selected; just confirms empty-click doesn't crash anything). ----
  await win.mouse.click(50, 200); // far upper-left of viewport
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-section="selection"]')).toHaveCount(0);
  await win.screenshot({ path: path.join(OUT, '09-empty-click.png'), fullPage: false });

  // Final state assertion via scene walk.
  const remaining = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) n++;
    });
    return n;
  });
  expect(remaining).toBe(1);

  // eslint-disable-next-line no-console
  console.log('  selection workflow: add 3 → pick cube → rotate → scale → pick sphere → delete-btn → pick cone → delete-key → 1 left');

  await app.close();
});
