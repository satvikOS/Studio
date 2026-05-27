import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 45 — Integration project #5: "Character Pipeline".
 *
 * Fifth complex-project integration test, focused on the character /
 * rigging / animation pipeline. Composes Armature (slice 15) +
 * Suzanne (slice 30) + Subdivision (slice 21) + Face Shape Keys
 * (slice 37) + Material Presets (slice 38) + Animation (slice 8)
 * + 3-Point Cinematic Lighting (slice 41) + Showreel (slice 24).
 *
 * Workflow:
 *   1. 10-bone armature as the character's "body".
 *   2. Suzanne head as the character's "face".
 *   3. Subdivide Suzanne once (smoother face).
 *   4. Apply Chrome material preset to Suzanne (sci-fi character).
 *   5. Apply face shape keys — smile 0.6, brow 0.4.
 *   6. Apply 3-Point Cinematic lighting.
 *   7. Animate the armature spinning at 90°/s.
 *   8. Capture 4-view showreel.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-character-pipeline');

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

test('Studio integration — Character Pipeline (armature + Suzanne + shape keys + animation + render)', async () => {
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

  // === Step 1 — 10-bone armature ===
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rigging"]').click();
  await win.waitForTimeout(200);
  await setRange(win, '[data-studio-armature="bones"]', '10');
  await win.locator('[data-studio-action="add-armature"]').click();
  await win.waitForTimeout(300);

  // === Step 2 — Suzanne head ===
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="modeling"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-primitive="suzanne"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('2 primitives in scene');

  // === Step 3 — Subdivide Suzanne ===
  await selectByKind(win, 'suzanne');
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('suzanne');
  const baseSuzanneFaces = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'suzanne') m = o; });
    return m ? m.geometry.index.count / 3 : 0;
  });
  await win.locator('[data-studio-action="subdivide-selected"]').click();
  await win.waitForTimeout(400);
  const subdSuzanneFaces = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'suzanne') m = o; });
    return m ? m.geometry.index.count / 3 : 0;
  });
  expect(subdSuzanneFaces).toBe(baseSuzanneFaces * 4);

  // === Step 4 — Chrome material on Suzanne ===
  await win.locator('[data-studio-material-preset="chrome"]').click();
  await win.waitForTimeout(200);

  // === Step 5 — Face shape keys (smile + brow) ===
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rigging"]').click();
  await win.waitForTimeout(200);
  await setRange(win, '[data-studio-shapekey="smile"]', '0.6');
  await win.waitForTimeout(200);
  await setRange(win, '[data-studio-shapekey="brow"]',  '0.4');
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-shapekey-readout="smile"]')).toHaveText('0.60');
  await expect(win.locator('[data-studio-shapekey-readout="brow"]')).toHaveText('0.40');

  // === Step 6 — 3-point cinematic ===
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rendering"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-action="three-point-preset"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-light-count]')).toHaveText('3 added');

  // === Step 7 — Animate (Suzanne still selected) ===
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="animation"]').click();
  await win.waitForTimeout(200);
  await setRange(win, '[data-studio-animation="speed"]', '90');
  await win.locator('[data-studio-action="toggle-animation"]').click();
  await expect(win.locator('[data-studio-animation-state]')).toHaveText('playing');

  // === Step 8 — Showreel ===
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rendering"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-action="capture-showreel"]').click();
  await expect
    .poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()),
          { timeout: 12000 })
    .toBe(4);

  // === Final integrated assertions ===
  const finalState = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const kinds = new Set();
    let prim = 0, lights = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        prim++;
        kinds.add(o.userData.archdiscStudioPrimitiveKind);
      }
      if (o.userData && o.userData.archdiscStudioLight && o.isLight) lights++;
    });
    return { prim, lights, kinds: Array.from(kinds).sort() };
  });
  expect(finalState.prim).toBe(2); // armature + suzanne
  expect(finalState.lights).toBe(3);
  expect(finalState.kinds).toEqual(['armature', 'suzanne']);
  // Subdivided Suzanne (4× base faces).
  expect(subdSuzanneFaces).toBe(baseSuzanneFaces * 4);

  // ---- Headline frames around the spinning character ----
  for (const a of [0, 90, 180, 270]) {
    await win.evaluate((az) => window.__archdiscOrbitView && window.__archdiscOrbitView(az, 18, 1), a);
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `01-character-az${a}.png`), fullPage: false });
  }

  // Stop animation cleanly before app close.
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="animation"]').click();
  await win.waitForTimeout(150);
  await win.locator('[data-studio-action="toggle-animation"]').click();

  // eslint-disable-next-line no-console
  console.log(`  character pipeline: armature + subdivided chrome Suzanne (smile 0.6 + brow 0.4) under 3-point lighting, spinning, showreel captured`);

  await app.close();
});
