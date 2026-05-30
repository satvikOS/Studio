import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 249: global lights intensity multiplier slider.
 * Headed Mac Electron. Body scaled large per the scale-to-viewer rule.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-lights-multiplier');

test('Studio — N-panel lights multiplier scales every Studio light', async () => {
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

  // Build a big teapot + 2 lights so the slider has something to scale.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'lights mul demo',
      scene: { discipline: 'rendering', lights: [
        { type: 'light-point', color: '#ffe6c0', intensity: 0.2 },
        { type: 'light-sun',   color: '#ffffff', intensity: 0.25 },
      ] },
      bodies: [{ kind: 'teapot', pos: [0, 0, 0], scale: [4, 4, 4], color: '#bfa14a' }],
      expect: { bodies: 1, kinds: ['teapot'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => { if (window.__studioFrameAll) window.__studioFrameAll(); });
  await win.waitForTimeout(300);

  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(300);

  // Snapshot baseline intensities.
  const before = await win.evaluate(() => {
    const out = [];
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioLight && o.isLight) out.push(o.intensity);
    });
    return out;
  });
  expect(before.length).toBeGreaterThan(0);

  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-npanel-lights-mul]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '2.5');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await win.waitForTimeout(300);

  const after = await win.evaluate(() => {
    const out = [];
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioLight && o.isLight) out.push(o.intensity);
    });
    return out;
  });
  // Each intensity multiplied by 2.5.
  for (let i = 0; i < before.length; i++) {
    expect(after[i] / before[i], `light ${i} scaled 2.5x`).toBeCloseTo(2.5, 1);
  }
  expect(await win.evaluate(() => window.__studioLightsMul)).toBeCloseTo(2.5, 2);
  await win.screenshot({ path: path.join(OUT, '00-lit-brighter.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 249: lights multiplier scales every light end-to-end');

  await app.close();
});
