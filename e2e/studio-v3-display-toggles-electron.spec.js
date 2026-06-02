import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-display-toggles');

test('Studio V3 — N-panel Display toggles drive overlays (slice 536)', async () => {
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
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    window.localStorage.removeItem('studio.v3.display-toggles');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await expect(win.locator('[data-studio-v3-display-section]')).toBeVisible();

  // Minimap is visible by default.
  const mini = win.locator('[data-studio-v3-minimap]');
  await expect(mini).toBeVisible();

  // Toggle minimap off.
  await win.locator('[data-studio-v3-display-toggle="minimap"]').click();
  await win.waitForTimeout(200);
  await expect(mini).toHaveCSS('display', 'none');

  // Toggle watermark off.
  await win.locator('[data-studio-v3-display-toggle="watermark"]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-watermark]')).toHaveCSS('display', 'none');

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 536: display toggles hide minimap + watermark');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
