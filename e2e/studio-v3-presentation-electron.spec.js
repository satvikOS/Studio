import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-presentation');

test('Studio V3 — Cmd+P presentation mode (slice 479)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
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

  // Stats overlay visible by default.
  await expect(win.locator('[data-studio-v3-viewport-stats]')).toBeVisible();

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Cmd+P → presentation mode.
  await win.keyboard.press('Meta+p');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-shell]'))
    .toHaveAttribute('data-studio-v3-presentation', 'true');
  // Overlays gone.
  await expect(win.locator('[data-studio-v3-viewport-stats]')).toHaveCount(0);
  await expect(win.locator('[data-studio-v3-axis-gizmo]')).toHaveCount(0);
  // Banner appears.
  await expect(win.locator('[data-studio-v3-presentation-banner]')).toBeVisible();

  // Esc exits.
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-shell]'))
    .toHaveAttribute('data-studio-v3-presentation', 'false');
  await expect(win.locator('[data-studio-v3-viewport-stats]')).toBeVisible();

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 479: presentation mode hides overlays + shows banner');

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
