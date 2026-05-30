import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 229: viewport background colour picker in N-panel View tab.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-bg-color');

test('Studio — N-panel View tab background colour drives renderer clear colour', async () => {
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

  // Switch N-panel to View tab.
  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(300);

  // Drive the colour input.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-npanel-bg]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '#22aa66');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.waitForTimeout(300);

  const result = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const cc = vp.renderer.getClearColor(new (require('three') ? require('three').Color : window.THREE.Color)());
    return {
      mirror: window.__studioBgColor,
      scene: vp.scene && vp.scene.background && vp.scene.background.getHexString && vp.scene.background.getHexString(),
    };
  }).catch(async () => {
    // Three is bundled, not requireable. Read via __studioBgColor + scene.background.
    return await win.evaluate(() => ({
      mirror: window.__studioBgColor,
      scene: window.__archdiscViewport.scene.background && window.__archdiscViewport.scene.background.getHexString
        ? window.__archdiscViewport.scene.background.getHexString() : null,
    }));
  });
  expect(result.mirror).toBe('#22aa66');
  expect(result.scene).toBe('22aa66');
  await win.screenshot({ path: path.join(OUT, '00-green-bg.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 229: viewport background colour control working');

  await app.close();
});
