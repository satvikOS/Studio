import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 254: shadow quality dropdown.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-shadow-quality');

test('Studio — N-panel shadow quality drives renderer.shadowMap state', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetShadowQuality === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(300);

  // Diagnostic probe — set + read in the same evaluate to remove
  // any React/render scheduler race.
  const probe = await win.evaluate(() => {
    window.__studioSetShadowQuality('off');
    return {
      enabled: window.__archdiscViewport.renderer.shadowMap.enabled,
      quality: window.__studioShadowQuality,
    };
  });
  // eslint-disable-next-line no-console
  console.log('  probe:', JSON.stringify(probe));
  expect(probe.enabled).toBe(false);
  expect(probe.quality).toBe('off');

  // High.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-npanel-shadow-quality]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(el, 'high');
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.waitForTimeout(200);
  expect(await win.evaluate(() => window.__archdiscViewport.renderer.shadowMap.enabled)).toBe(true);
  expect(await win.evaluate(() => window.__studioShadowQuality)).toBe('high');
  await win.screenshot({ path: path.join(OUT, '00-high.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 254: shadow quality toggle working');

  await app.close();
});
