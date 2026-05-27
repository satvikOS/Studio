import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 26 — AI Prompt Stub.
 *
 * Type a natural-language prompt, click Run Prompt, watch a keyword
 * router fire Studio actions and append a log entry. First concrete
 * preview of the AI plug-and-play vision — the harness (prompt →
 * action list → actions execute) is the durable contract; the
 * router itself will swap to the real Clarifier/Planner/Verifier
 * loop in a later slice.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-ai-prompt');

test('Studio AI prompt — natural-language commands fire Studio actions', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 250,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- Baseline ----
  await expect(win.locator('[data-studio-section="ai"]')).toBeVisible();
  await expect(win.locator('[data-studio-ai-runs]')).toHaveText('0 runs');
  await expect(win.locator('[data-studio-ai="prompt"]')).toHaveValue('add a cube and a torus knot');
  await win.screenshot({ path: path.join(OUT, '00-ai-panel-default.png'), fullPage: false });

  // ---- Prompt 1: default — adds 2 primitives ----
  await win.locator('[data-studio-action="run-ai-prompt"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('2 primitives in scene');
  await expect(win.locator('[data-studio-ai-runs]')).toHaveText('1 run');
  // The log's most recent entry (index 0 when reversed) should mention
  // the keyword actions ("cube" and "torus knot").
  await expect(win.locator('[data-studio-ai-actions]').first()).toContainText('add cube');
  await expect(win.locator('[data-studio-ai-actions]').first()).toContainText('add torus knot');
  await win.screenshot({ path: path.join(OUT, '01-after-prompt-1.png'), fullPage: false });

  // ---- Prompt 2: "spin them" → starts animation ----
  await win.locator('[data-studio-ai="prompt"]').fill('spin them');
  await win.locator('[data-studio-action="run-ai-prompt"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-animation-state]')).toHaveText('playing');
  await expect(win.locator('[data-studio-ai-runs]')).toHaveText('2 runs');
  await expect(win.locator('[data-studio-ai-actions]').first()).toContainText('start animation');
  await win.screenshot({ path: path.join(OUT, '02-after-spin.png'), fullPage: false });

  // ---- Prompt 3: "stop and add a light" → stops + light ----
  await win.locator('[data-studio-ai="prompt"]').fill('stop and add a light');
  await win.locator('[data-studio-action="run-ai-prompt"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-animation-state]')).toHaveText('idle');
  await expect(win.locator('[data-studio-light-count]')).toHaveText('1 added');
  await expect(win.locator('[data-studio-ai-actions]').first()).toContainText('stop animation');
  await expect(win.locator('[data-studio-ai-actions]').first()).toContainText('add cinematic light');
  await win.screenshot({ path: path.join(OUT, '03-after-stop-light.png'), fullPage: false });

  // ---- Prompt 4: "render" → captures one thumbnail ----
  await win.locator('[data-studio-ai="prompt"]').fill('render');
  await win.locator('[data-studio-action="run-ai-prompt"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-render-count]')).toHaveText('1');
  await win.screenshot({ path: path.join(OUT, '04-after-render.png'), fullPage: false });

  // ---- Prompt 5: "clear the scene" → wipes primitives ----
  await win.locator('[data-studio-ai="prompt"]').fill('clear the scene');
  await win.locator('[data-studio-action="run-ai-prompt"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('0 primitives in scene');
  await expect(win.locator('[data-studio-ai-runs]')).toHaveText('5 runs');
  await win.screenshot({ path: path.join(OUT, '05-after-clear.png'), fullPage: false });

  // ---- Prompt 6: "compose demo" → fires the full pipeline ----
  await win.locator('[data-studio-ai="prompt"]').fill('compose demo');
  await win.locator('[data-studio-action="run-ai-prompt"]').click();
  await expect
    .poll(async () => await win.locator('[data-studio-primitive-count]').textContent(),
          { timeout: 10000 })
    .toBe('6 primitives in scene');
  await win.screenshot({ path: path.join(OUT, '06-after-compose-demo.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log('  ai prompt: 6 prompts routed → primitives, animation, lights, renders, clear, compose-demo');

  await app.close();
});
