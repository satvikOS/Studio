import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-hdri-dropdown');

test('Studio — N-panel HDRI preset dropdown (slice 291)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetHDRIEnvironment === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Open N-panel and switch to View tab.
  await win.evaluate(() => {
    const btn = document.querySelector('[data-studio-npanel-tab="View"]');
    if (btn) btn.click();
  });
  await win.waitForTimeout(300);

  await expect(win.locator('[data-studio-npanel-hdri]')).toBeVisible();

  // Select 'studio' via the dropdown — onChange wires __studioSetHDRIEnvironment.
  await win.evaluate(() => {
    const sel = document.querySelector('[data-studio-npanel-hdri]');
    sel.value = 'studio';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.waitForTimeout(400);
  const preset1 = await win.evaluate(() => window.__studioHDRIPreset);
  expect(preset1).toBe('studio');

  // Switch to 'sunset'.
  await win.evaluate(() => {
    const sel = document.querySelector('[data-studio-npanel-hdri]');
    sel.value = 'sunset';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.waitForTimeout(400);
  expect(await win.evaluate(() => window.__studioHDRIPreset)).toBe('sunset');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 291: HDRI dropdown switched studio → sunset');

  await app.close();
});
