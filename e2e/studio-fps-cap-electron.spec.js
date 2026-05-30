import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 252: FPS cap dropdown limits render loop.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-fps-cap');

test('Studio — N-panel FPS cap throttles the render loop', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 700,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(300);

  // Cap at 15 FPS.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-npanel-fps-cap]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(el, '15');
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.waitForTimeout(2000);

  // Cap is in effect.
  const cap = await win.evaluate(() => window.__studioFpsCap);
  expect(cap).toBe(15);
  // Measure actual renderer frame deltas (HUD counts RAFs which still
  // fire at 60 even when we skip-render most of them).
  const renderRate = await win.evaluate(async () => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.renderer) return null;
    const before = vp.renderer.info.render.frame || 0;
    await new Promise((r) => setTimeout(r, 1000));
    const after = vp.renderer.info.render.frame || 0;
    return after - before;
  });
  expect(renderRate, 'renderer.frame delta over 1 s capped').toBeLessThan(30);
  await win.screenshot({ path: path.join(OUT, '00-capped-15.png') });

  // Reset to unlimited so the rest of the suite isn't slowed.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-npanel-fps-cap]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(el, '0');
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 252: FPS cap throttled to 15 (renderer.frame delta=', renderRate, ')');

  await app.close();
});
