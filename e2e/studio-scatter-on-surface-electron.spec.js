import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 34 — Scatter on Surface (Geometry-Nodes-style instance scatter).
 *
 * Closes gap #4 from the video-scope survey: the Geometry-Nodes
 * "Instance on Points" pattern visible in Video-879 (Blender scatter
 * of buildings across a road mesh).
 *
 * Pick a target primitive, choose what to scatter (cube / sphere /
 * cone / cylinder / tetra), set count + scale, click Scatter on
 * Selected → InstancedMesh of N instances oriented along the
 * target's triangle normals. Deterministic (every triangle index
 * picked via i/N step, not random).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-scatter-on-surface');

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

async function screenPosOf(win, kind) {
  return await win.evaluate(({ k }) => {
    const vp = window.__archdiscViewport;
    let mesh = null;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) mesh = o;
    });
    if (!mesh) return null;
    const v = mesh.position.clone().project(vp.camera);
    const rect = vp.renderer.domElement.getBoundingClientRect();
    return {
      x: (v.x + 1) / 2 * rect.width + rect.left,
      y: (-v.y + 1) / 2 * rect.height + rect.top,
    };
  }, { k: kind });
}

test('Studio scatter on surface — Suzanne covered in 500 mini-cones', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 250,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- Scatter section visible, disabled until selection ----
  await expect(win.locator('[data-studio-section="scatter"]')).toBeVisible();
  await expect(win.locator('[data-studio-action="scatter-on-surface"]')).toBeDisabled();

  // ---- Add Suzanne as the target. 484 triangles → plenty of points to scatter on. ----
  await win.locator('[data-studio-primitive="suzanne"]').click();
  await win.waitForTimeout(400);
  // Select Suzanne via the exposed __studioSelectMesh API — calls the
  // same code path the raycast pointerdown does, but reliably avoids
  // misses when the mesh sits near the viewport edge.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let mesh = null;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'suzanne') mesh = o;
    });
    if (mesh && window.__studioSelectMesh) window.__studioSelectMesh(mesh);
  });
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('suzanne');
  await expect(win.locator('[data-studio-action="scatter-on-surface"]')).toBeEnabled();

  // ---- Configure scatter: 500 cones, 0.15 scale ----
  await win.locator('[data-studio-scatter="kind"]').selectOption('cone');
  await setRange(win, '[data-studio-scatter="count"]', '500');
  await setRange(win, '[data-studio-scatter="scale"]', '0.15');
  await expect(win.locator('[data-studio-scatter-readout="count"]')).toHaveText('500');
  await expect(win.locator('[data-studio-scatter-readout="scale"]')).toHaveText('0.15');

  // ---- Run the scatter ----
  await win.locator('[data-studio-action="scatter-on-surface"]').click();
  await win.waitForTimeout(600);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('2 primitives in scene');

  const scatterState = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let im = null;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'scatter') im = o;
    });
    if (!im) return null;
    return {
      isInstanced: !!im.isInstancedMesh,
      count: im.count,
      sourceKind: im.userData.archdiscStudioScatterKind,
      recordedCount: im.userData.archdiscStudioScatterCount,
    };
  });
  expect(scatterState).not.toBeNull();
  expect(scatterState.isInstanced).toBe(true);
  expect(scatterState.count).toBe(500);
  expect(scatterState.sourceKind).toBe('cone');
  expect(scatterState.recordedCount).toBe(500);

  // ---- Multi-angle captures showing the Suzanne pin-cushion ----
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(0, 15, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-suzanne-front.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(60, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-suzanne-az60.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(180, 15, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '02-suzanne-back.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(270, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '03-suzanne-side.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  scatter: 500 cones on suzanne's 484 triangles (deterministic i/N stepping; one InstancedMesh draw call)`);

  await app.close();
});
