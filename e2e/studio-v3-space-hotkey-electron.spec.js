import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-space-hotkey');

test('Studio V3 — Space toggles animation play / pause (slice 440)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioToggleAnimating === 'function', null, { timeout: 15000 });

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Default not animating.
  const a0 = await win.evaluate(() => window.__studioGetAnimating());
  expect(a0).toBe(false);

  // Space → animating true.
  await win.keyboard.press(' ');
  await win.waitForTimeout(150);
  const a1 = await win.evaluate(() => window.__studioGetAnimating());
  expect(a1).toBe(true);

  // Space → animating false.
  await win.keyboard.press(' ');
  await win.waitForTimeout(150);
  const a2 = await win.evaluate(() => window.__studioGetAnimating());
  expect(a2).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 440: Space flips animating false → true → false');

  await app.close();
});
