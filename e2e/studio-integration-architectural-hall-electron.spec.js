import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 36 — Integration project #3: "Architectural Hall".
 *
 * Third complex-project test, this one focused on the ArchViz +
 * Motion-Graphics + Lighting pipeline. No Math.random anywhere; the
 * runtime is fully deterministic.
 *
 * Workflow (~10 disciplines):
 *   1. Rectangle floor (main hall, 30 mm walls).
 *   2. L-shape annex (taller, 45 mm walls).
 *   3. U-shape entry (shorter, 18 mm walls).
 *   4. Three column lathes — Vase, Goblet, Column profiles.
 *   5. 3D text label "ArchDisc Studio" at 18 mm.
 *   6. Three cinematic lights — warm tungsten + cool sky + magenta accent.
 *   7. Volumetric "dust" — 1500 particles at small size for atmosphere.
 *   8. Suzanne mascot in the hall (the imported Blender primitive).
 *   9. Render frame for a hero shot.
 *  10. Four-view showreel.
 *  11. Sepia + Contrast compositing passes on the renders.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-architectural-hall');

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

test('Studio integration — build an Architectural Hall across the ArchViz pipeline', async () => {
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
  await win.screenshot({ path: path.join(OUT, '00-empty.png'), fullPage: false });

  // === Floor: 3 ArchViz pieces stacked ===
  await win.locator('[data-studio-archviz="shape"]').selectOption('rectangle');
  await setRange(win, '[data-studio-archviz="height"]', '0.030');
  await win.locator('[data-studio-action="extrude-floorplan"]').click();
  await win.waitForTimeout(300);

  await win.locator('[data-studio-archviz="shape"]').selectOption('L-shape');
  await setRange(win, '[data-studio-archviz="height"]', '0.045');
  await win.locator('[data-studio-action="extrude-floorplan"]').click();
  await win.waitForTimeout(300);

  await win.locator('[data-studio-archviz="shape"]').selectOption('U-shape');
  await setRange(win, '[data-studio-archviz="height"]', '0.018');
  await win.locator('[data-studio-action="extrude-floorplan"]').click();
  await win.waitForTimeout(300);

  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('3 primitives in scene');

  // === Columns: 3 lathes ===
  for (const profile of ['vase', 'goblet', 'column']) {
    await win.locator('[data-studio-lathe="profile"]').selectOption(profile);
    await setRange(win, '[data-studio-lathe="segments"]', '48');
    await win.locator('[data-studio-action="add-lathe"]').click();
    await win.waitForTimeout(250);
  }
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('6 primitives in scene');

  // === Mascot: Suzanne ===
  await win.locator('[data-studio-primitive="suzanne"]').click();
  await win.waitForTimeout(250);

  // === 3D Text label ===
  await expect(win.locator('[data-studio-font-state]')).toHaveText('font ready', { timeout: 15000 });
  await win.locator('[data-studio-text3d="input"]').fill('ArchDisc Studio');
  await setRange(win, '[data-studio-text3d="size"]', '0.018');
  await win.locator('[data-studio-action="add-text3d"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('8 primitives in scene');
  await win.screenshot({ path: path.join(OUT, '01-floors-columns-mascot-text.png'), fullPage: false });

  // === Lights: 3-point cinematic ===
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rendering"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-lighting="color"]').fill('#ffb56b');
  await setRange(win, '[data-studio-lighting="intensity"]', '2.8');
  await win.locator('[data-studio-action="add-light"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-lighting="color"]').fill('#6bb5ff');
  await setRange(win, '[data-studio-lighting="intensity"]', '1.6');
  await win.locator('[data-studio-action="add-light"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-lighting="color"]').fill('#d469c4');
  await setRange(win, '[data-studio-lighting="intensity"]', '1.0');
  await win.locator('[data-studio-action="add-light"]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-light-count]')).toHaveText('3 added');

  // === Dust atmosphere ===
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="vfx-sim"]').click();
  await win.waitForTimeout(200);
  await setRange(win, '[data-studio-particles="count"]', '1500');
  await setRange(win, '[data-studio-particles="size"]', '0.0008');
  await win.locator('[data-studio-action="spawn-particles"]').click();
  await win.waitForTimeout(400);
  // 8 archviz/lathe/mascot/text + 1 particle cloud = 9 prim total via traverse.
  const totalPrim = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let n = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n;
  });
  expect(totalPrim).toBe(9);

  // === Renders ===
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rendering"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(35, 22, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '02-pre-render-hero-pose.png'), fullPage: false });
  await win.locator('[data-studio-action="render-frame"]').click();
  await win.waitForTimeout(400);
  await win.locator('[data-studio-action="capture-showreel"]').click();
  await expect
    .poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()),
          { timeout: 12000 })
    .toBe(5);

  // === Compositing: sepia + contrast passes ===
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="compositing"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-compositing="filter"]').selectOption('sepia(100%)');
  await win.locator('[data-studio-action="post-process"]').click();
  await expect
    .poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()),
          { timeout: 6000 })
    .toBe(6);
  await win.locator('[data-studio-compositing="filter"]').selectOption('contrast(180%)');
  await win.locator('[data-studio-action="post-process"]').click();
  await expect
    .poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()),
          { timeout: 6000 })
    .toBe(7);

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
      if (o.userData && o.userData.archdiscStudioLight) lights++;
    });
    return { prim, lights, kinds: Array.from(kinds).sort() };
  });
  expect(finalState.prim).toBe(9);
  expect(finalState.lights).toBe(3);
  const expectedKinds = [
    'floor-plan-L-shape',
    'floor-plan-U-shape',
    'floor-plan-rectangle',
    'lathe-column',
    'lathe-goblet',
    'lathe-vase',
    'particles',
    'suzanne',
    'text-3d',
  ];
  expect(finalState.kinds).toEqual(expectedKinds);

  // ---- Headline turntable frames ----
  for (const a of [40, 130, 220, 310]) {
    await win.evaluate((az) => window.__archdiscOrbitView && window.__archdiscOrbitView(az, 22, 1), a);
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `03-final-hall-az${a}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  architectural hall: ${finalState.prim} primitives + ${finalState.lights} lights + 7 renders across ArchViz + lathe + text + particles + lighting + compositing`);

  await app.close();
});
