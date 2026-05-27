import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 64 — Integration project #6: "Animated Mechanical Showcase".
 *
 * Sixth complex-project integration test. Exercises Array (slice 54) +
 * Decimate (49) + Material Presets (38) + Keyframe Animation (56) +
 * Motion Path (57) + 3-Point Lighting (41) + Showreel (24) — the
 * animation / mechanical-design slice of the toolchain.
 *
 * Workflow:
 *   1. Spawn 1 icosahedron seed.
 *   2. Radial-array into 6 copies on a 30mm ring (so 6 total in scene).
 *   3. Select the seed + decimate it once (vary geometry visually).
 *   4. Apply Chrome material to the seed.
 *   5. Keyframe the seed at frame 0 + frame 120 with rotation only.
 *   6. Toggle motion path overlay ON.
 *   7. Apply 3-point lighting.
 *   8. Capture 4-view showreel.
 *   9. Multi-angle headline shots.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-animated-showcase');

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

test('Studio integration — Animated Mechanical Showcase (array + keyframes + motion-path)', async () => {
  test.setTimeout(180000);
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

  // === Step 1 — seed icosahedron ===
  await win.locator('[data-studio-primitive="icosahedron"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'icosahedron');
  await win.waitForTimeout(300);

  // === Step 2 — radial array of 6 around the seed ===
  await win.locator('[data-studio-array="mode"]').selectOption('radial');
  await setRange(win, '[data-studio-array="count"]',  '6');
  await setRange(win, '[data-studio-array="radius"]', '0.03');
  await win.locator('[data-studio-action="apply-array"]').click();
  await win.waitForTimeout(400);

  // Scene has 1 seed + 5 array copies = 6 icosahedra.
  const after2 = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let total = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive &&
          o.userData.archdiscStudioPrimitiveKind &&
          o.userData.archdiscStudioPrimitiveKind.startsWith('icosahedron')) total++;
    });
    return total;
  });
  expect(after2).toBe(6);
  await win.screenshot({ path: path.join(OUT, '01-radial-array-of-6.png'), fullPage: false });

  // === Step 3 — decimate the seed (others stay full-res) ===
  await selectByKind(win, 'icosahedron');
  await win.waitForTimeout(300);
  await setRange(win, '[data-studio-decimate="aggressiveness"]', '0.5');
  await win.locator('[data-studio-action="decimate-selected"]').click();
  await win.waitForTimeout(400);

  // === Step 4 — Chrome material on seed ===
  await win.locator('[data-studio-material-preset="chrome"]').click();
  await win.waitForTimeout(200);

  // === Step 5 — Keyframes (rotate-only) ===
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="animation"]').click();
  await win.waitForTimeout(300);
  await setRange(win, '[data-studio-timeline="frame"]', '0');
  await win.locator('[data-studio-action="insert-keyframe"]').click();
  await win.waitForTimeout(200);
  // Rotate seed via evaluate.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'icosahedron') m = o; });
    if (m) m.rotation.y = Math.PI * 1.5; // 270°
  });
  await setRange(win, '[data-studio-timeline="frame"]', '120');
  await win.locator('[data-studio-action="insert-keyframe"]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-keyframe-count]')).toHaveText('2 keyframes · idle');

  // === Step 6 — Motion path ON ===
  await win.locator('[data-studio-timeline="show-motion-path"]').check();
  await win.waitForTimeout(400);
  const motionLines = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let n = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioMotionPath) n++; });
    return n;
  });
  // Single keyframed mesh -> 1 motion line. (Position didn't change but
  // line vertices are still emitted across the keyframe span.)
  expect(motionLines).toBe(1);

  // === Step 7 — 3-point lighting ===
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rendering"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-action="three-point-preset"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-light-count]')).toHaveText('3 added');

  // === Step 8 — Showreel ===
  await win.locator('[data-studio-action="capture-showreel"]').click();
  await expect.poll(
    async () => Number(await win.locator('[data-studio-render-count]').textContent()),
    { timeout: 12000 },
  ).toBe(4);

  // === Final integrated assertions ===
  const finalState = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const kinds = {};
    let prim = 0, lights = 0, lines = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        prim++;
        const k = o.userData.archdiscStudioPrimitiveKind || 'mesh';
        kinds[k] = (kinds[k] || 0) + 1;
      }
      if (o.userData && o.userData.archdiscStudioLight && o.isLight) lights++;
      if (o.userData && o.userData.archdiscStudioMotionPath) lines++;
    });
    return { prim, lights, lines, kinds };
  });
  expect(finalState.prim).toBe(6);
  expect(finalState.lights).toBe(3);
  expect(finalState.lines).toBe(1);
  expect(finalState.kinds['icosahedron']).toBe(1);
  expect(finalState.kinds['icosahedron-array']).toBe(5);

  // ---- Headline shots — 4 orbit angles of the full scene ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `02-showcase-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  animated showcase: 1 seed icosa + 5 radial copies = 6 prims, seed decimated + chrome, keyframed [0, 120], motion path on, 3-point light, showreel x4`);

  await app.close();
});
