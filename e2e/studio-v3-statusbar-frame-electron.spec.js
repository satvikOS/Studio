import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-statusbar-frame');

test('Studio V3 — status bar shows current frame (slice 453)', async () => {
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
  await win.waitForTimeout(500);

  // Initial frame is 0.
  const f0 = win.locator('[data-studio-v3-status="frame"]');
  await expect(f0).toBeVisible();
  await expect(f0).toHaveAttribute('data-studio-v3-frame', '0');

  // Move to frame 12.
  await win.evaluate(() => window.__studioSetFrame(12));
  await win.waitForTimeout(100);
  await expect(f0).toHaveAttribute('data-studio-v3-frame', '12');

  // Back to 0.
  await win.evaluate(() => window.__studioSetFrame(0));
  await win.waitForTimeout(100);
  await expect(f0).toHaveAttribute('data-studio-v3-frame', '0');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 453: status bar frame display tracks __studioSetFrame');

  await app.close();
});
