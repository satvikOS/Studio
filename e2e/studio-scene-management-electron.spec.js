import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 4 — Studio scene management.
 *
 * Drives the entire build-and-tear-down workflow as a real user:
 *   1. App opens, Studio is the default workbench, Modeling tab is
 *      active → 10 primitive buttons rendered (the original 6 plus
 *      Torus Knot, Icosa, Dodeca, Tetra).
 *   2. Delete Last + Clear Scene buttons exist in the Mesh stats
 *      section and start disabled (no primitives in the scene).
 *   3. The user composes a mixed scene by clicking 5 different
 *      primitive buttons in turn. After every click, the in-scene
 *      counter ticks, the Vertices / Faces stats grow, and the
 *      Delete Last / Clear Scene buttons become enabled.
 *   4. The user clicks Delete Last twice; counter / stats drop by
 *      one each time.
 *   5. The user clicks Clear Scene; counter = 0, stats = 0/0, both
 *      management buttons disable again.
 *
 * Real Electron launch via _electron.launch, slowMo paced for a
 * human watcher, every interaction a real click in the rendered UI.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-scene-management');

// Pick a representative mix that spans the original primitives + the
// 4 new ones added in this slice.
const COMPOSITION = ['cube', 'sphere', 'torus-knot', 'icosahedron', 'tetrahedron'];

test('Studio scene management — compose, Delete Last, Clear Scene', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 350,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // Studio defaults.
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscScene, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- Baseline: 10 primitive buttons, empty scene, management buttons disabled ----
  await expect(win.locator('[data-studio-primitive]')).toHaveCount(10);
  await expect(win.locator('[data-studio-stat="vertices"]')).toHaveValue('0');
  await expect(win.locator('[data-studio-stat="faces"]')).toHaveValue('0');
  await expect(win.locator('[data-studio-action="delete-last"]')).toBeDisabled();
  await expect(win.locator('[data-studio-action="clear-scene"]')).toBeDisabled();
  await win.screenshot({ path: path.join(OUT, '00-empty-buttons-disabled.png'), fullPage: false });

  // ---- Compose: 5 mixed primitives, real click each ----
  for (let i = 0; i < COMPOSITION.length; i++) {
    const kind = COMPOSITION[i];
    await win.locator(`[data-studio-primitive="${kind}"]`).click();
    await win.waitForTimeout(500);
    await expect(win.locator('[data-studio-primitive-count]')).toHaveText(
      `${i + 1} primitive${i === 0 ? '' : 's'} in scene`,
      { timeout: 5000 },
    );
    // First add enables the management buttons.
    await expect(win.locator('[data-studio-action="delete-last"]')).toBeEnabled();
    await expect(win.locator('[data-studio-action="clear-scene"]')).toBeEnabled();
    await win.screenshot({ path: path.join(OUT, `01-add-${i + 1}-${kind}.png`), fullPage: false });
  }

  // Composed-scene readouts captured for later assertion.
  const composedV = Number(await win.locator('[data-studio-stat="vertices"]').inputValue());
  const composedF = Number(await win.locator('[data-studio-stat="faces"]').inputValue());
  expect(composedV).toBeGreaterThan(0);
  expect(composedF).toBeGreaterThan(0);

  // Multi-angle viewport check on the composed scene.
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(35, 25, 1));
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '02-composed-scene-az35.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(135, 30, 1));
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '03-composed-scene-az135.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(225, 30, 1));
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '04-composed-scene-az225.png'), fullPage: false });

  // ---- Delete Last x2 ----
  for (let i = 0; i < 2; i++) {
    const expectedAfter = COMPOSITION.length - 1 - i;
    await win.locator('[data-studio-action="delete-last"]').click();
    await win.waitForTimeout(400);
    await expect(win.locator('[data-studio-primitive-count]')).toHaveText(
      `${expectedAfter} primitive${expectedAfter === 1 ? '' : 's'} in scene`,
      { timeout: 5000 },
    );
    const v = Number(await win.locator('[data-studio-stat="vertices"]').inputValue());
    const f = Number(await win.locator('[data-studio-stat="faces"]').inputValue());
    expect(v).toBeLessThan(composedV);
    expect(f).toBeLessThan(composedF);
    await win.screenshot({ path: path.join(OUT, `05-delete-last-${i + 1}.png`), fullPage: false });
  }

  // ---- Clear Scene ----
  await win.locator('[data-studio-action="clear-scene"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('0 primitives in scene', { timeout: 5000 });
  await expect(win.locator('[data-studio-stat="vertices"]')).toHaveValue('0');
  await expect(win.locator('[data-studio-stat="faces"]')).toHaveValue('0');
  await expect(win.locator('[data-studio-action="delete-last"]')).toBeDisabled();
  await expect(win.locator('[data-studio-action="clear-scene"]')).toBeDisabled();

  // Scene has zero Studio-tagged meshes left in the actual three.js tree.
  const remaining = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) n++;
    });
    return n;
  });
  expect(remaining).toBe(0);

  await win.screenshot({ path: path.join(OUT, '06-cleared-scene.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  scene management: composed ${COMPOSITION.length} primitives → deleted 2 → cleared all → ${remaining} remaining`);

  await app.close();
});
