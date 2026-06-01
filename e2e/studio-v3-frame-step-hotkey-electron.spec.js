import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-frame-step');

test('Studio V3 — ← / → step animation frame (slice 441)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetFrame === 'function', null, { timeout: 15000 });

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Reset to 0.
  await win.evaluate(() => window.__studioSetFrame(0));
  let f = await win.evaluate(() => window.__studioGetFrame());
  expect(f).toBe(0);

  // → → → goes to 3.
  await win.keyboard.press('ArrowRight');
  await win.keyboard.press('ArrowRight');
  await win.keyboard.press('ArrowRight');
  await win.waitForTimeout(150);
  f = await win.evaluate(() => window.__studioGetFrame());
  expect(f).toBe(3);

  // ← drops to 2.
  await win.keyboard.press('ArrowLeft');
  await win.waitForTimeout(150);
  f = await win.evaluate(() => window.__studioGetFrame());
  expect(f).toBe(2);

  // ← ← ← clamps at 0.
  await win.keyboard.press('ArrowLeft');
  await win.keyboard.press('ArrowLeft');
  await win.keyboard.press('ArrowLeft');
  await win.waitForTimeout(150);
  f = await win.evaluate(() => window.__studioGetFrame());
  expect(f).toBe(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 441: ← / → step frame, clamps at 0 (0→3→2→0)');

  await app.close();
});
