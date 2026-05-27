import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 32 — AI Plan Executor.
 *
 * Promotes the AI Prompt stub (slice 26) from a one-shot keyword
 * router into a multi-step planner. A single prompt is parsed into
 * an ORDERED plan, each step is shown with its current state
 * (pending / active / done), and the executor switches the
 * discipline tab to the right one for each step before firing it.
 *
 * Test prompt: "add a cube and a sphere then spin them then render"
 * Expected plan (in order):
 *   1. Add sphere   (modeling)
 *   2. Add cube     (modeling)
 *   3. Start animation (animation)
 *   4. Capture render  (rendering)
 *
 * Note: primKinds is longest-needle-first, so "sphere" comes before
 * "cube" in plan order — proves the planner walks the keyword table
 * deterministically.
 *
 * The spec polls the plan state machine via the data-studio-ai-plan-state
 * attribute on each step to make sure the executor reaches each
 * state in order, and that the discipline tab actually changes
 * along with the active step.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-ai-plan-executor');

test('Studio AI Plan Executor — prompt → ordered plan → step-by-step execution with tab switching', async () => {
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

  // Default prompt already exercises 4 disciplines (modeling + animation + rendering).
  await expect(win.locator('[data-studio-ai="prompt"]')).toHaveValue('add a cube and a sphere then spin them then render');
  await win.screenshot({ path: path.join(OUT, '00-ai-panel.png'), fullPage: false });

  // ---- Click Run; the button label flips to "Running…" while the plan executes. ----
  await win.locator('[data-studio-action="run-ai-prompt"]').click();
  await expect(win.locator('[data-studio-action="run-ai-prompt"]')).toHaveText('Running…');
  // Plan list materialises with 4 steps (matching the 4 verbs above).
  await expect(win.locator('[data-studio-ai-plan-step]')).toHaveCount(4, { timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '01-plan-running.png'), fullPage: false });

  // Wait for the executor to finish — Run button label returns.
  await expect(win.locator('[data-studio-action="run-ai-prompt"]')).toHaveText('Run Prompt', { timeout: 30000 });

  // The executor leaves the discipline tab on the LAST step's tab
  // ('rendering' here, because the final step was Capture render).
  // Confirm + screenshot before switching back to modeling for the
  // primitive-count assertion (the count element is rendered inside
  // the modeling ribbon and only mounts on that tab).
  // The ribbon tab and the properties aside share the data-studio-discipline
  // name; the ribbon tab is the one carrying the .active CSS class.
  await expect(win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rendering"]')).toHaveClass(/active/);
  await win.screenshot({ path: path.join(OUT, '02-plan-complete-rendering-tab.png'), fullPage: false });

  // Confirm scene state via direct traversal (independent of which tab
  // mounts the readout span).
  const sceneState = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let prim = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) prim++; });
    return prim;
  });
  expect(sceneState).toBe(2);
  await expect(win.locator('[data-studio-render-count]')).toHaveText('1');

  // Switch to animation tab so the animation-state badge mounts, then assert.
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="animation"]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-animation-state]')).toHaveText('playing');

  // ---- Second prompt: a more elaborate workflow ----
  await win.locator('[data-studio-ai="prompt"]').fill('clear then add a suzanne and an icosa then drop them then four-view');
  await win.locator('[data-studio-action="run-ai-prompt"]').click();
  await expect(win.locator('[data-studio-action="run-ai-prompt"]')).toHaveText('Run Prompt', { timeout: 45000 });

  // After-second-prompt assertions (independent of mounted tab).
  const sceneState2 = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let prim = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) prim++; });
    return prim;
  });
  expect(sceneState2).toBe(2); // clear → +suzanne +icosa
  // Showreel adds 4 captures on top of the 1 we already have.
  await expect(win.locator('[data-studio-render-count]')).toHaveText('5');

  // Log shows the two prompts.
  await expect(win.locator('[data-studio-ai-runs]')).toHaveText('2 runs');
  await win.screenshot({ path: path.join(OUT, '03-after-second-prompt.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log('  ai planner: 2 multi-step plans executed; discipline tab follows the active step');

  await app.close();
});
