import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 13 — ArchViz / Floor Plan extrusion.
 *
 * The right panel exposes a Shape selector (Rectangle / L-Shape /
 * U-Shape) and a wall-height slider. Extrude Floor Plan turns the
 * 2D Shape into a 3D building-block ExtrudeGeometry and drops it
 * into the scene as a Studio primitive — selection, material edits,
 * sculpt brushes all operate on it identically.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-archviz');

test('Studio ArchViz — Rectangle / L-shape / U-shape extruded into 3D buildings', async () => {
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

  await expect(win.locator('[data-studio-section="archviz"]')).toBeVisible();
  await expect(win.locator('[data-studio-archviz-readout="height"]')).toHaveText('30.0 mm');
  await win.screenshot({ path: path.join(OUT, '00-archviz-default-panel.png'), fullPage: false });

  // ---- Rectangle (default) ----
  await win.locator('[data-studio-action="extrude-floorplan"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('1 primitive in scene');
  const rectKind = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let k = null;
    vp.scene.traverse(o => {
      if (o.userData && /^floor-plan-/.test(o.userData.archdiscStudioPrimitiveKind || '')) {
        k = o.userData.archdiscStudioPrimitiveKind;
      }
    });
    return k;
  });
  expect(rectKind).toBe('floor-plan-rectangle');
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(35, 30, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-rectangle-extruded.png'), fullPage: false });

  // ---- L-Shape at a taller wall height ----
  await win.locator('[data-studio-archviz="shape"]').selectOption('L-shape');
  await win.locator('[data-studio-archviz="height"]').fill('0.045');
  await win.dispatchEvent('[data-studio-archviz="height"]', 'input');
  await expect(win.locator('[data-studio-archviz-readout="height"]')).toHaveText('45.0 mm');
  await win.locator('[data-studio-action="extrude-floorplan"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('2 primitives in scene');
  await win.screenshot({ path: path.join(OUT, '02-lshape-tall.png'), fullPage: false });

  // ---- U-Shape, shorter wall ----
  await win.locator('[data-studio-archviz="shape"]').selectOption('U-shape');
  await win.locator('[data-studio-archviz="height"]').fill('0.02');
  await win.dispatchEvent('[data-studio-archviz="height"]', 'input');
  await win.locator('[data-studio-action="extrude-floorplan"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('3 primitives in scene');

  // Tally distinct floor-plan kinds present in the scene.
  const distinct = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const kinds = new Set();
    vp.scene.traverse(o => {
      if (o.userData && /^floor-plan-/.test(o.userData.archdiscStudioPrimitiveKind || '')) {
        kinds.add(o.userData.archdiscStudioPrimitiveKind);
      }
    });
    return Array.from(kinds).sort();
  });
  expect(distinct).toEqual([
    'floor-plan-L-shape',
    'floor-plan-U-shape',
    'floor-plan-rectangle',
  ]);

  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(45, 35, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '03-three-buildings-az45.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(225, 35, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '04-three-buildings-az225.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  archviz: rectangle → L-shape (45mm) → U-shape (20mm); ${distinct.length} distinct floor-plan kinds`);

  await app.close();
});
