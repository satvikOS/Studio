import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-hdri-picker');

test('Studio V3 — Settings modal HDRI environment picker (slice 468)', async () => {
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

  // Open Settings.
  await win.locator('[data-studio-v3-qat-btn="settings"]').click();
  await win.waitForTimeout(200);

  // HDRI section appears with at least one preset button.
  const presets = await win.evaluate(() => Array.from(document.querySelectorAll('[data-studio-v3-settings-hdri]'))
    .map((el) => el.getAttribute('data-studio-v3-settings-hdri')));
  expect(presets.length).toBeGreaterThan(0);

  // Pick the first non-'off' preset (or first if only 'off' exists).
  const target = presets.find((p) => p !== 'off') || presets[0];
  await win.locator(`[data-studio-v3-settings-hdri="${target}"]`).click();
  await win.waitForTimeout(400);

  // Active pill should be data-active="true" on the target.
  await expect(win.locator(`[data-studio-v3-settings-hdri="${target}"]`))
    .toHaveAttribute('data-active', 'true');
  // If target isn't 'off', scene.environment should be populated.
  if (target !== 'off') {
    const hasEnv = await win.evaluate(() => {
      const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
      return !!s.environment;
    });
    expect(hasEnv).toBe(true);
  }

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 468: HDRI presets =', presets, 'picked', target);

  await app.close();
});
