import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-grs-hotkeys');

test('Studio V3 — G/R/S transform-tool hotkeys (slice 429)', async () => {
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

  // Focus off text inputs so hotkeys fire.
  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Default tool is select.
  await expect(win.locator('[data-studio-v3-tool="select"][data-studio-v3-tool-group="transform"]'))
    .toHaveAttribute('data-active', 'true');

  // G → move.
  await win.keyboard.press('g');
  await win.waitForTimeout(100);
  await expect(win.locator('[data-studio-v3-tool="move"][data-studio-v3-tool-group="transform"]'))
    .toHaveAttribute('data-active', 'true');

  // R → rotate.
  await win.keyboard.press('r');
  await win.waitForTimeout(100);
  await expect(win.locator('[data-studio-v3-tool="rotate"][data-studio-v3-tool-group="transform"]'))
    .toHaveAttribute('data-active', 'true');

  // S → scale.
  await win.keyboard.press('s');
  await win.waitForTimeout(100);
  await expect(win.locator('[data-studio-v3-tool="scale"][data-studio-v3-tool-group="transform"]'))
    .toHaveAttribute('data-active', 'true');

  // Esc back to select.
  await win.keyboard.press('Escape');
  await win.waitForTimeout(100);
  await expect(win.locator('[data-studio-v3-tool="select"][data-studio-v3-tool-group="transform"]'))
    .toHaveAttribute('data-active', 'true');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 429: G/R/S cycle select→move→rotate→scale, Esc back to select');

  await app.close();
});
