import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-projection-hotkey');

test('Studio V3 — 5 toggles persp / ortho projection (slice 450)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioToggleViewProjection === 'function', null, { timeout: 15000 });

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Reset projection state.
  await win.evaluate(() => { delete window.__studioViewProjection; });

  await win.keyboard.press('5');
  await win.waitForTimeout(150);
  const p1 = await win.evaluate(() => window.__studioViewProjection);
  expect(['ortho', 'persp']).toContain(p1);

  await win.keyboard.press('5');
  await win.waitForTimeout(150);
  const p2 = await win.evaluate(() => window.__studioViewProjection);
  expect(p2).not.toBe(p1);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 450: 5 flips projection', p1, '→', p2);

  await app.close();
});
