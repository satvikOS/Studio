import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 17 — Texture · UV (procedural canvas textures).
 *
 * Four built-in patterns (Checkerboard / Brick / Grid / Procedural
 * Noise) rasterise onto a 512×512 canvas, wrap as THREE.CanvasTexture,
 * and become the selected mesh's material.map. Tile count + pattern
 * are both live-editable; Apply Texture replaces, Remove Texture
 * detaches.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-texture');

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

async function setRange(win, selector, value) {
  await win.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel: selector, val: value });
}

async function meshHasMap(win, kind) {
  return await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let result = false;
    vp.scene.traverse(o => {
      if (o.isMesh && o.userData
          && o.userData.archdiscStudioPrimitiveKind === k
          && o.material && o.material.map) {
        result = true;
      }
    });
    return result;
  }, kind);
}

test('Studio texture — Checkerboard / Brick / Grid / Noise applied, then removed', async () => {
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

  await expect(win.locator('[data-studio-section="texture"]')).toBeVisible();
  await expect(win.locator('[data-studio-action="apply-texture"]')).toBeDisabled();

  // ---- Add a cube + sphere; pick the cube (largest flat faces = clearest pattern) ----
  for (const k of ['cube', 'sphere']) {
    await win.locator(`[data-studio-primitive="${k}"]`).click();
    await win.waitForTimeout(300);
  }
  const cubePos = await screenPosOfMesh(win, 0);
  await win.mouse.click(cubePos.x, cubePos.y);
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-action="apply-texture"]')).toBeEnabled();
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(30, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-cube-selected.png'), fullPage: false });
  expect(await meshHasMap(win, 'cube')).toBe(false);

  // ---- Checkerboard at 8 tiles (default) ----
  await win.locator('[data-studio-action="apply-texture"]').click();
  await win.waitForTimeout(400);
  expect(await meshHasMap(win, 'cube')).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-checker-8.png'), fullPage: false });

  // ---- Bump tiles to 16, switch pattern to Brick, re-apply ----
  await setRange(win, '[data-studio-texture="tiles"]', '16');
  await expect(win.locator('[data-studio-texture-readout="tiles"]')).toHaveText('16');
  await win.locator('[data-studio-texture="pattern"]').selectOption('brick');
  await win.locator('[data-studio-action="apply-texture"]').click();
  await win.waitForTimeout(400);
  expect(await meshHasMap(win, 'cube')).toBe(true);
  await win.screenshot({ path: path.join(OUT, '02-brick-16.png'), fullPage: false });

  // ---- Grid at 24 tiles ----
  await setRange(win, '[data-studio-texture="tiles"]', '24');
  await win.locator('[data-studio-texture="pattern"]').selectOption('grid');
  await win.locator('[data-studio-action="apply-texture"]').click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '03-grid-24.png'), fullPage: false });

  // ---- Procedural Noise at 32 tiles ----
  await setRange(win, '[data-studio-texture="tiles"]', '32');
  await win.locator('[data-studio-texture="pattern"]').selectOption('noise');
  await win.locator('[data-studio-action="apply-texture"]').click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '04-noise-32.png'), fullPage: false });

  // ---- Switch selection to the sphere, apply Brick to it independently ----
  const spherePos = await screenPosOfMesh(win, 1);
  await win.mouse.click(spherePos.x, spherePos.y);
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('sphere');
  // Sphere starts without a texture map.
  expect(await meshHasMap(win, 'sphere')).toBe(false);
  await setRange(win, '[data-studio-texture="tiles"]', '6');
  await win.locator('[data-studio-texture="pattern"]').selectOption('brick');
  await win.locator('[data-studio-action="apply-texture"]').click();
  await win.waitForTimeout(400);
  expect(await meshHasMap(win, 'sphere')).toBe(true);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(60, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '05-sphere-bricked.png'), fullPage: false });

  // ---- Remove texture from sphere → map gone ----
  await win.locator('[data-studio-action="remove-texture"]').click();
  await win.waitForTimeout(300);
  expect(await meshHasMap(win, 'sphere')).toBe(false);
  await win.screenshot({ path: path.join(OUT, '06-sphere-untextured.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log('  texture: cube → checker(8) → brick(16) → grid(24) → noise(32); sphere → brick(6) → removed');

  await app.close();
});
