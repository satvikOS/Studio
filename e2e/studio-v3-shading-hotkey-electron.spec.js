import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-shading-hotkey');

test('Studio V3 — Z cycles shading mode (slice 451)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioGetShadingMode === 'function', null, { timeout: 15000 });

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Reset to solid.
  await win.evaluate(() => window.__studioSetShadingMode('solid'));

  await win.keyboard.press('z');
  await win.waitForTimeout(150);
  expect(await win.evaluate(() => window.__studioGetShadingMode())).toBe('material');

  await win.keyboard.press('z');
  await win.waitForTimeout(150);
  expect(await win.evaluate(() => window.__studioGetShadingMode())).toBe('rendered');

  await win.keyboard.press('z');
  await win.waitForTimeout(150);
  expect(await win.evaluate(() => window.__studioGetShadingMode())).toBe('wire');

  await win.keyboard.press('z');
  await win.waitForTimeout(150);
  expect(await win.evaluate(() => window.__studioGetShadingMode())).toBe('solid');

  // Cmd+Z should still undo, not change shading.
  await win.evaluate(() => window.__studioSetShadingMode('rendered'));
  await win.keyboard.press('Meta+z');
  await win.waitForTimeout(150);
  // shading mode unchanged from rendered (Cmd+Z went to undo).
  expect(await win.evaluate(() => window.__studioGetShadingMode())).toBe('rendered');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 451: Z cycles shading solid → material → rendered → wire → solid');

  await app.close();
});
