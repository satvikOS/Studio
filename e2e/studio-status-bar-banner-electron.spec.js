import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 33 — UI/UX polish: viewport status bar + property-panel banner.
 *
 * Adds two always-visible, discipline-agnostic Studio-branded chrome
 * elements:
 *   1. Status bar overlaid at the bottom of the viewport — primitive
 *      count, lights, renders, animation / physics state, vert / face
 *      totals, current discipline. Updates live as the scene changes;
 *      survives every discipline tab switch.
 *   2. ArchDisc Studio banner at the top of the right panel, with the
 *      current discipline name as a subtitle.
 *
 * Spec exercises both: builds a complex little scene and watches the
 * status-bar fields tick alongside the actions.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-status-bar-banner');

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

test('Studio status bar + banner — always-visible chrome that tracks scene state', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 2200,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- Both chrome elements are mounted ----
  await expect(win.locator('[data-studio-status-bar]')).toBeVisible();
  await expect(win.locator('[data-studio-banner]')).toBeVisible();
  await expect(win.locator('[data-studio-banner-discipline]')).toHaveText('Modeling');
  await expect(win.locator('[data-studio-status="discipline"]')).toHaveText('Modeling');
  await expect(win.locator('[data-studio-status="primitives"]')).toHaveText('0 prim');
  await expect(win.locator('[data-studio-status="lights"]')).toHaveText('0 lt');
  await expect(win.locator('[data-studio-status="renders"]')).toHaveText('0 rdr');
  await expect(win.locator('[data-studio-status="animation"]')).toHaveText('idle');
  await win.screenshot({ path: path.join(OUT, '00-empty-scene-baseline.png'), fullPage: false });

  // ---- Build the scene; status bar fields tick along with it ----
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(250);
  await win.locator('[data-studio-primitive="suzanne"]').click();
  await win.waitForTimeout(250);
  await expect(win.locator('[data-studio-status="primitives"]')).toHaveText('2 prim');

  // Switch to Rendering tab → banner subtitle + status bar's discipline both follow.
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rendering"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-banner-discipline]')).toHaveText('Rendering');
  await expect(win.locator('[data-studio-status="discipline"]')).toHaveText('Rendering');
  // Status bar still shows primitives (it's tab-independent).
  await expect(win.locator('[data-studio-status="primitives"]')).toHaveText('2 prim');
  await win.screenshot({ path: path.join(OUT, '01-rendering-tab-with-2-prim.png'), fullPage: false });

  // Add a light + a render — both reflect immediately.
  await win.locator('[data-studio-action="add-light"]').click();
  await win.waitForTimeout(250);
  await expect(win.locator('[data-studio-status="lights"]')).toHaveText('1 lt');
  await win.locator('[data-studio-action="render-frame"]').click();
  await win.waitForTimeout(450);
  await expect(win.locator('[data-studio-status="renders"]')).toHaveText('1 rdr');
  await win.screenshot({ path: path.join(OUT, '02-after-light-and-render.png'), fullPage: false });

  // Drive the animation chip via the AI Prompt (the planner handles
  // selection-required actions on its own — selects a primitive
  // implicitly when it adds one for that step's prerequisites).
  await win.locator('[data-studio-ai="prompt"]').fill('add a cone and spin it');
  await win.locator('[data-studio-action="run-ai-prompt"]').click();
  await expect(win.locator('[data-studio-action="run-ai-prompt"]')).toHaveText('Run Prompt', { timeout: 30000 });
  await expect(win.locator('[data-studio-status="animation"]')).toHaveText('animating');
  await win.screenshot({ path: path.join(OUT, '03-animating-chip-lit.png'), fullPage: false });

  // ---- VFX / Sim tab: drop with gravity, watch the simulating chip. ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="vfx-sim"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-action="toggle-physics"]').click();
  await expect(win.locator('[data-studio-status="physics"]')).toHaveText('simulating');
  await win.waitForTimeout(600);
  await win.locator('[data-studio-action="toggle-physics"]').click();
  await expect(win.locator('[data-studio-status="physics"]')).toHaveText('idle');
  await win.screenshot({ path: path.join(OUT, '04-after-physics-pulse.png'), fullPage: false });

  // ---- Vertex / face count grew across all the work ----
  const vfText = await win.locator('[data-studio-status="vertices"]').textContent();
  expect(vfText).toMatch(/\d+,?\d* v · \d+,?\d* f/);

  // eslint-disable-next-line no-console
  console.log('  status bar: prim/lt/rdr/anim/sim chips all reactive; banner discipline follows ribbon tab');

  await app.close();
});
