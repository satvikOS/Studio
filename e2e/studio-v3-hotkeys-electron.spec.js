import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-hotkeys');

test('Studio V3 — Tab cycle + 1/2/3 sub-mode hotkeys (slice 428)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioGetEditMode === 'function', null, { timeout: 15000 });

  // Move focus off any input so Tab fires the hotkey, not focus traversal.
  await win.evaluate(() => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });

  // Default object mode.
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('object');

  // Tab cycle: object → vertex.
  await win.keyboard.press('Tab');
  await win.waitForTimeout(100);
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('vertex');

  // 1/2/3 work in sub-object mode.
  await win.keyboard.press('2');
  await win.waitForTimeout(100);
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('edge');
  await win.keyboard.press('3');
  await win.waitForTimeout(100);
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('face');
  await win.keyboard.press('1');
  await win.waitForTimeout(100);
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('vertex');

  // Tab again: vertex → edge.
  await win.keyboard.press('Tab');
  await win.waitForTimeout(100);
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('edge');

  // Tab three more times: edge → face → sculpt → object.
  await win.keyboard.press('Tab');
  await win.keyboard.press('Tab');
  await win.keyboard.press('Tab');
  await win.waitForTimeout(150);
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('object');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 428: Tab cycle + 1/2/3 flips edit mode correctly');

  await app.close();
});
