import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-splash');

test('Studio V3 — first-session splash appears then fades (slice 520)', async () => {
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
    try { window.sessionStorage.removeItem('studio.v3.splash-shown'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');

  // Splash should mount.
  await expect(win.locator('[data-studio-v3-splash]')).toBeVisible({ timeout: 5000 });

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // After 1.8 s the splash unmounts.
  await win.waitForTimeout(1800);
  await expect(win.locator('[data-studio-v3-splash]')).toHaveCount(0);

  // Shell should be ready.
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 5000 });

  // eslint-disable-next-line no-console
  console.log('  slice 520: splash appeared + faded');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
