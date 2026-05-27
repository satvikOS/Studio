import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 47 — Display modes: Wireframe / Bounding Box / Vertex Normals.
 *
 * View-time toggles in the Modeling panel that overlay edit-time
 * helpers on every Studio primitive in the scene. Helpers are tagged
 * with userData.archdiscStudioDisplayHelper so the sync routine can
 * clean them up without removing inherited viewport helpers.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-display-modes');

test('Studio display modes — Wireframe, Bounding Box, Vertex Normals overlays', async () => {
  test.setTimeout(120000);
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

  // Stage: 3 different primitives.
  for (const k of ['cube', 'sphere', 'torus-knot']) {
    await win.locator(`[data-studio-primitive="${k}"]`).click();
    await win.waitForTimeout(220);
  }
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('3 primitives in scene');
  await expect(win.locator('[data-studio-section="display"]')).toBeVisible();
  await expect(win.locator('[data-studio-display-status]')).toHaveText('solid');
  await win.screenshot({ path: path.join(OUT, '00-solid-3-primitives.png'), fullPage: false });

  // ---- Helper counts read directly from the scene tree ----
  const helperCounts = async () => await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let helpers = 0, boxHelpers = 0, normalHelpers = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioDisplayHelper) {
        helpers++;
        if (o.isLineSegments && o.type === 'BoxHelper') boxHelpers++;
        if (o.type === 'VertexNormalsHelper') normalHelpers++;
      }
    });
    return { helpers, boxHelpers, normalHelpers };
  });

  // Material wireframe state for every Studio primitive.
  const wireframeStates = async () => await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const states = [];
    vp.scene.traverse(o => {
      if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive && o.material) {
        states.push(Array.isArray(o.material) ? o.material[0].wireframe : o.material.wireframe);
      }
    });
    return states;
  });

  // ---- Toggle wireframe on ----
  await win.locator('[data-studio-display="wireframe"]').check();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-display-status]')).toHaveText('wireframe');
  const ws = await wireframeStates();
  expect(ws).toEqual([true, true, true]);
  await win.screenshot({ path: path.join(OUT, '01-wireframe.png'), fullPage: false });

  // ---- Bounding boxes ----
  await win.locator('[data-studio-display="bounding-box"]').check();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-display-status]')).toHaveText('wireframe + bbox');
  const hc1 = await helperCounts();
  expect(hc1.boxHelpers).toBe(3);
  await win.screenshot({ path: path.join(OUT, '02-wireframe-and-bbox.png'), fullPage: false });

  // ---- Vertex normals ----
  await win.locator('[data-studio-display="normals"]').check();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-display-status]')).toHaveText('wireframe + bbox + normals');
  const hc2 = await helperCounts();
  expect(hc2.boxHelpers).toBe(3);
  expect(hc2.normalHelpers).toBe(3);
  expect(hc2.helpers).toBe(6);
  await win.screenshot({ path: path.join(OUT, '03-all-three-modes.png'), fullPage: false });

  // ---- Multi-angle to verify overlays render at every orbit step ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 20, 1), az);
    await win.waitForTimeout(250);
    await win.screenshot({ path: path.join(OUT, `04-orbit-az${az}.png`), fullPage: false });
  }

  // ---- Toggle them all OFF — helpers and wireframes should be cleared ----
  await win.locator('[data-studio-display="wireframe"]').uncheck();
  await win.locator('[data-studio-display="bounding-box"]').uncheck();
  await win.locator('[data-studio-display="normals"]').uncheck();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-display-status]')).toHaveText('solid');
  const ws2 = await wireframeStates();
  expect(ws2).toEqual([false, false, false]);
  const hc3 = await helperCounts();
  expect(hc3.helpers).toBe(0);
  await win.screenshot({ path: path.join(OUT, '05-back-to-solid.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  display modes: 3 prims, 3 bbox + 3 normal helpers added then cleared (total ${hc2.helpers} → 0)`);

  await app.close();
});
