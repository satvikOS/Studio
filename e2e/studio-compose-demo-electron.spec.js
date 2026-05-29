import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 25 — Compose Demo Scene: one-click integrated-pipeline preview.
 *
 * The Compose Demo Scene button (top of the Welcome panel) drives the
 * Studio toolchain end-to-end: clear → add 5 primitives → add a
 * procedural tree → add 2 cinematic lights → orbit + capture 2 renders.
 * Proves the layers (primitives, procedural, lighting, rendering)
 * compose into a single sequenced flow — a precursor to the AI
 * plug-and-play vision.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-compose-demo');

test('Studio compose demo — one click → 6 primitives + 2 lights + 2 renders', async () => {
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

  await expect(win.locator('[data-studio-action="compose-demo"]')).toBeVisible();
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('0 primitives in scene');
  await expect(win.locator('[data-studio-render-count]')).toHaveText('0');
  await expect(win.locator('[data-studio-light-count]')).toHaveText('0 added');

  // ---- One click — the whole pipeline fires asynchronously ----
  await win.locator('[data-studio-action="compose-demo"]').click();

  // The compose loop is sequenced over ~1.5–2 s; poll for the
  // terminal state (6 primitives, 2 renders, 2 lights).
  await expect
    .poll(async () => await win.locator('[data-studio-primitive-count]').textContent(),
          { timeout: 10000, message: 'primitive count never reached 6' })
    .toBe('6 primitives in scene');
  await expect
    .poll(async () => await win.locator('[data-studio-render-count]').textContent(),
          { timeout: 10000, message: 'render count never reached 2' })
    .toBe('2');
  await expect
    .poll(async () => await win.locator('[data-studio-light-count]').textContent(),
          { timeout: 10000, message: 'light count never reached 2' })
    .toBe('2 added');

  // Scene assertions: 6 Studio primitives, 2 Studio lights.
  const counts = await win.evaluate(() => {
    let prim = 0, light = 0;
    window.__archdiscScene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) prim++;
      if (o.userData && o.userData.archdiscStudioLight) light++;
    });
    return { prim, light };
  });
  expect(counts.prim).toBe(6);
  expect(counts.light).toBe(2);

  // Multi-angle captures of the assembled scene.
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(35, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-composed-scene-az35.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(150, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '02-composed-scene-az150.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(285, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '03-composed-scene-az285.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log('  compose demo: 1 click → 6 primitives + 2 lights + 2 renders');

  await app.close();
});
