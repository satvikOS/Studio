import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-file-menu');

test('Studio V3 — File menu lists actions + recent files (slice 550)', async () => {
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
    window.localStorage.setItem('archdisc.studio.recentFiles', JSON.stringify([
      { name: 'session-1.studio.json', ts: 2, json: '{"version":3,"primitives":[]}' },
    ]));
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-v3-menu="file"]').click();
  await win.waitForTimeout(200);

  const menu = win.locator('[data-studio-v3-file-menu]');
  await expect(menu).toBeVisible();

  // Action rows.
  await expect(win.locator('[data-studio-v3-file-action="save"]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-file-action="export-obj"]')).toBeVisible();

  // Recent row.
  await expect(win.locator('[data-studio-v3-file-recent="session-1.studio.json"]')).toBeVisible();

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // Esc closes.
  await win.keyboard.press('Escape');
  await win.waitForTimeout(150);
  await expect(menu).toHaveCount(0);

  // eslint-disable-next-line no-console
  console.log('  slice 550: File menu actions + recent + Esc dismiss');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
