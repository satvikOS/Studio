import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — LAYOUT SMOKE TEST.
 *
 * Catches the regression where the Blender workspaces strip + N-panel
 * additions broke the workbench-stage CSS Grid and pushed the strip
 * to the bottom while leaving the viewport invisible. Asserts:
 *   - workspaces strip is at the TOP (within first 60 px)
 *   - the 3D viewport canvas is visible and has positive width/height
 *   - the discipline ribbon is BELOW the workspaces strip
 *   - the viewport renders the scene (screenshot captures the body)
 *
 * Headed Mac Electron run.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-layout-smoke');

test('Studio — workspaces strip on top, viewport visible, ribbon below', async () => {
  test.setTimeout(120000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 600,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Workspaces strip + ribbon-placeholder + canvas all present.
  const layout = await win.evaluate(() => {
    const strip = document.querySelector('[data-blender-workspaces-strip="studio"]');
    const ribbon = document.querySelector('[data-archdisc-ribbon-placeholder="studio"]');
    const canvas = document.querySelector('#render-canvas-studio') || document.querySelector('canvas');
    const stage = document.querySelector('.workbench-stage');
    return {
      stripTop:  strip  ? strip.getBoundingClientRect().top  : null,
      stripHeight: strip ? strip.getBoundingClientRect().height : null,
      ribbonTop: ribbon ? ribbon.getBoundingClientRect().top : null,
      canvasW:   canvas ? canvas.getBoundingClientRect().width  : null,
      canvasH:   canvas ? canvas.getBoundingClientRect().height : null,
      canvasTop: canvas ? canvas.getBoundingClientRect().top    : null,
      stageH:    stage  ? stage.getBoundingClientRect().height  : null,
    };
  });
  // eslint-disable-next-line no-console
  console.log('  layout:', JSON.stringify(layout));

  // Strip is at the top of the workbench area.
  expect(layout.stripTop, 'strip exists').not.toBeNull();
  expect(layout.stripTop, 'strip near top').toBeLessThan(60);
  expect(layout.stripHeight, 'strip ~30 px tall').toBeGreaterThan(20);
  expect(layout.stripHeight, 'strip ~30 px tall').toBeLessThan(45);

  // Ribbon is BELOW the strip.
  expect(layout.ribbonTop, 'ribbon below strip').toBeGreaterThanOrEqual(layout.stripTop + layout.stripHeight - 1);

  // Canvas is rendered with positive size.
  expect(layout.canvasW, 'canvas has width').toBeGreaterThan(200);
  expect(layout.canvasH, 'canvas has height').toBeGreaterThan(200);

  await win.screenshot({ path: path.join(OUT, '00-layout.png') });
  await win.waitForTimeout(1500);

  // Build a body so the screenshot proves the renderer is alive.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'layout smoke',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'teapot', pos: [0, 0, 0], scale: [1, 1, 1], color: '#bfa14a' },
      ],
      expect: { bodies: 1, kinds: ['teapot'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(OUT, '01-teapot.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 194b: layout regression fixed — strip top, viewport visible, ribbon below');

  await app.close();
});
