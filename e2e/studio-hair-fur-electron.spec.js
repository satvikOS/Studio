import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 51 — Hair / Fur particles.
 *
 * Spawns hundreds of thin cylindrical strands rooted on a surface
 * mesh's triangle centroids, oriented along the triangle normals.
 * Backed by a single InstancedMesh (one draw call), tagged as a
 * Studio primitive so the rest of the toolchain treats it as a
 * first-class object.
 *
 * Deterministic — same mesh + same count always picks the same
 * triangles (stride through the index buffer), so two runs yield
 * identical positions. Verified by reading per-instance matrices
 * back and comparing across runs.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-hair-fur');

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

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function hairChecksum(win) {
  return await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let h = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'hair') h = o; });
    if (!h) return null;
    let sum = 0;
    const m = new (vp.camera.up.constructor.constructor.constructor)(); // dummy
    // Pull the raw instanceMatrix buffer and checksum it.
    const arr = h.instanceMatrix.array;
    for (let i = 0; i < arr.length; i++) sum += Math.abs(arr[i]);
    return {
      count:    h.count,
      bufferLen: arr.length,
      checksum: sum,
      hairOf:   h.userData.archdiscStudioHairOf,
    };
  });
}

test('Studio Hair / Fur — deterministic instanced strands on a surface mesh', async () => {
  test.setTimeout(120000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 200,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Spawn Suzanne, subdivide once so the head has enough triangles.
  await win.locator('[data-studio-primitive="suzanne"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'suzanne');
  await win.waitForTimeout(300);
  await win.locator('[data-studio-action="subdivide-selected"]').click();
  await win.waitForTimeout(400);

  // VFX/Sim tab to access Hair UI.
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="vfx-sim"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-section="particles"]')).toBeVisible();

  // ---- Run 1 ----
  await setRange(win, '[data-studio-hair="count"]',  '800');
  await setRange(win, '[data-studio-hair="length"]', '0.01');
  await expect(win.locator('[data-studio-hair-readout="length"]')).toHaveText('10.0 mm');
  await win.locator('[data-studio-action="grow-hair"]').click();
  await win.waitForTimeout(500);

  const run1 = await hairChecksum(win);
  expect(run1).not.toBeNull();
  expect(run1.count).toBeGreaterThan(700);
  expect(run1.hairOf).toBe('suzanne');
  await win.screenshot({ path: path.join(OUT, '01-hair-run1.png'), fullPage: false });

  // ---- Run 2 — clear scene, repeat ----
  // Switch back to modeling to access Clear Scene.
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="modeling"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-action="clear-scene"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('0 primitives in scene');

  await win.locator('[data-studio-primitive="suzanne"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'suzanne');
  await win.waitForTimeout(300);
  await win.locator('[data-studio-action="subdivide-selected"]').click();
  await win.waitForTimeout(400);

  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="vfx-sim"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-action="grow-hair"]').click();
  await win.waitForTimeout(500);

  const run2 = await hairChecksum(win);
  expect(run2.count).toBe(run1.count);
  expect(run2.bufferLen).toBe(run1.bufferLen);
  // Determinism — identical instance matrices means identical positions.
  expect(run2.checksum).toBeCloseTo(run1.checksum, 3);

  // ---- Higher strand count -> more instances ----
  await win.locator('[data-studio-action="clear-scene"]'); // (left over from modeling tab — no need to click; just leaving here for clarity)
  // Spawn a fresh hair on top, with higher count, on the existing suzanne.
  await setRange(win, '[data-studio-hair="count"]', '2000');
  await win.locator('[data-studio-action="grow-hair"]').click();
  await win.waitForTimeout(500);
  // Count hair primitives in scene — should be 2 (no auto-cleanup of old hair).
  const hairs = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let n = 0, total = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'hair') {
        n++; total += o.count;
      }
    });
    return { n, total };
  });
  expect(hairs.n).toBe(2);
  expect(hairs.total).toBeGreaterThan(2500);

  // ---- 4-angle orbit captures of furry Suzanne ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 18, 1), az);
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `02-furry-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  hair: ${run1.count} strands on suzanne (run1 cs=${run1.checksum.toFixed(2)} == run2 cs=${run2.checksum.toFixed(2)}, deterministic); total hair instances now ${hairs.total}`);

  await app.close();
});
