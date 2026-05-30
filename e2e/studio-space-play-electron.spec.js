import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 211: Spacebar toggles animation play/pause.
 *
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-space-play');

test('Studio — Space toggles animation play/pause', async () => {
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
  await win.waitForFunction(() => typeof window.__studioToggleAnimating === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Initial: not animating (flag undefined until first toggle).
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
  await win.waitForTimeout(400);
  expect(await win.evaluate(() => window.__studioAnimatingFlag), 'play').toBe(true);
  await win.screenshot({ path: path.join(OUT, '00-playing.png') });
  await win.waitForTimeout(600);

  // Space again → pause.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
  await win.waitForTimeout(400);
  expect(await win.evaluate(() => window.__studioAnimatingFlag), 'pause').toBe(false);
  await win.screenshot({ path: path.join(OUT, '01-paused.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 211: Space play/pause working');

  await app.close();
});
