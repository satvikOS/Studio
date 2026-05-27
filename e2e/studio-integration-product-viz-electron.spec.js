import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 42 — Integration project #4: "Product Viz Showcase".
 *
 * Fourth complex integration test, focused on the photoreal-product
 * pipeline (KeyShot-style). Uses the brand-new material presets +
 * three-point lighting + camera presets together with the existing
 * primitive / archviz / showreel / compositing tools.
 *
 * Workflow:
 *   1. Rectangle ArchViz floor as the plinth.
 *   2. Five "products" — sphere (gold), torus knot (chrome), cube
 *      (glass), cone (plastic), cylinder (wood). Each material drops
 *      in via the matching one-click PBR preset.
 *   3. Apply 3-Point Cinematic lighting preset.
 *   4. Save the scene (so we have a JSON snapshot to verify load).
 *   5. Walk the camera through 6 view presets, render each.
 *   6. Sepia + Saturate 2.5x post-process passes on the most recent.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-product-viz');

const PRODUCT_LINE = [
  { kind: 'sphere',     material: 'gold'   },
  { kind: 'torus-knot', material: 'chrome' },
  { kind: 'cube',       material: 'glass'  },
  { kind: 'cone',       material: 'plastic'},
  { kind: 'cylinder',   material: 'wood'   },
];

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

test('Studio integration — Product Viz Showcase (materials + 3-point + camera presets)', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 180,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // === Step 1 — plinth ===
  await win.locator('[data-studio-archviz="shape"]').selectOption('rectangle');
  await win.locator('[data-studio-action="extrude-floorplan"]').click();
  await win.waitForTimeout(300);

  // === Step 2 — 5 product primitives with matching presets ===
  for (const { kind, material } of PRODUCT_LINE) {
    await win.locator(`[data-studio-primitive="${kind}"]`).click();
    await win.waitForTimeout(220);
    await selectByKind(win, kind);
    await win.waitForTimeout(220);
    await win.locator(`[data-studio-material-preset="${material}"]`).click();
    await win.waitForTimeout(180);
  }
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('6 primitives in scene');
  await win.screenshot({ path: path.join(OUT, '01-product-line.png'), fullPage: false });

  // === Step 3 — 3-point cinematic ===
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rendering"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-action="three-point-preset"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-light-count]')).toHaveText('3 added');

  // === Step 4 — save snapshot (preset materials + lights all included) ===
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="modeling"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-action="save-scene"]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-scene-io-status]')).toContainText('Saved');

  // === Step 5 — render each camera preset ===
  const presets = ['front', 'right', 'back', 'left', 'iso', 'top'];
  let expectedRenders = 0;
  for (const id of presets) {
    await win.locator(`[data-studio-camera-preset="${id}"]`).click();
    await win.waitForTimeout(300);
    await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rendering"]').click();
    await win.waitForTimeout(150);
    await win.locator('[data-studio-action="render-frame"]').click();
    expectedRenders++;
    await expect(win.locator('[data-studio-render-count]')).toHaveText(String(expectedRenders), { timeout: 5000 });
    await win.screenshot({ path: path.join(OUT, `02-render-${id}.png`), fullPage: false });
    // back to modeling so the camera preset row is visible for the next click.
    await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="modeling"]').click();
    await win.waitForTimeout(150);
  }

  // === Step 6 — compositing passes ===
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="compositing"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-compositing="filter"]').selectOption('sepia(100%)');
  await win.locator('[data-studio-action="post-process"]').click();
  await expect
    .poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()),
          { timeout: 6000 })
    .toBe(expectedRenders + 1);
  await win.locator('[data-studio-compositing="filter"]').selectOption('saturate(2.5)');
  await win.locator('[data-studio-action="post-process"]').click();
  await expect
    .poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()),
          { timeout: 6000 })
    .toBe(expectedRenders + 2);

  // === Final assertions ===
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
  expect(finalState.prim).toBe(6);
  expect(finalState.lights).toBe(3);
  expect(finalState.kinds).toEqual([
    'cone', 'cube', 'cylinder', 'floor-plan-rectangle',
    'sphere', 'torus-knot',
  ]);
  await expect(win.locator('[data-studio-render-count]')).toHaveText(String(expectedRenders + 2));

  // eslint-disable-next-line no-console
  console.log(`  product viz: ${finalState.prim} prim + ${finalState.lights} lights + ${expectedRenders + 2} renders (${expectedRenders} raw + 2 post)`);

  await app.close();
});
