import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-sun-angle');

test('Studio V3 — Settings sun angle sliders (slice 469)', async () => {
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

  const az = win.locator('[data-studio-v3-settings-sun-azimuth]');
  const el = win.locator('[data-studio-v3-settings-sun-elevation]');
  await expect(az).toBeVisible();
  await expect(el).toBeVisible();

  // Record key light pos before, slide azimuth to π, check pos changes.
  const before = await win.evaluate(() => {
    const k = window.__archdiscViewport && window.__archdiscViewport.keyLight;
    return k ? [k.position.x, k.position.y, k.position.z] : null;
  });
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-settings-sun-azimuth]');
    el.value = Math.PI.toFixed(3);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.waitForTimeout(200);
  const after = await win.evaluate(() => {
    const k = window.__archdiscViewport && window.__archdiscViewport.keyLight;
    return k ? [k.position.x, k.position.y, k.position.z] : null;
  });
  expect(before).toBeTruthy();
  expect(after).toBeTruthy();
  // Position moved (azimuth flips sign on X / Z roughly).
  const dist = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
  expect(dist).toBeGreaterThan(0.1);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 469: key light moved by', dist.toFixed(3));

  await app.close();
});
