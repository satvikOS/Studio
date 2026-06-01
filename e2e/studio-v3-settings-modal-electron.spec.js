import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-settings-modal');

test('Studio V3 — settings modal flips theme + shading + bg (slice 454)', async () => {
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
  await win.waitForTimeout(400);

  // Settings hidden by default.
  await expect(win.locator('[data-studio-v3-settings]')).toHaveCount(0);

  // QAT settings button opens it.
  await win.locator('[data-studio-v3-qat-btn="settings"]').click();
  await win.waitForTimeout(200);
  const modal = win.locator('[data-studio-v3-settings]');
  await expect(modal).toBeVisible();

  // Flip theme to light.
  await win.locator('[data-studio-v3-settings-theme="light"]').click();
  await expect(win.locator('[data-studio-v3-settings-theme="light"]'))
    .toHaveAttribute('data-active', 'true');
  expect(await win.evaluate(() => document.documentElement.getAttribute('data-studio-theme'))).toBe('light');

  // Set shading to wire.
  await win.locator('[data-studio-v3-settings-shading="wire"]').click();
  expect(await win.evaluate(() => window.__studioGetShadingMode && window.__studioGetShadingMode())).toBe('wire');

  // Esc closes.
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-settings]')).toHaveCount(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 454: settings modal opens, theme + shading flip, Esc closes');

  await app.close();
});
