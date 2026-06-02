import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-welcome-recent');

test('Studio V3 — welcome card lists recent files when empty (slice 539)', async () => {
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
      { name: 'design-alpha.studio.json', ts: 2, json: '{"version":3,"primitives":[]}' },
      { name: 'design-beta.studio.json', ts: 1, json: '{"version":3,"primitives":[]}' },
    ]));
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(700); // welcome card polls every 500 ms

  await expect(win.locator('[data-studio-v3-welcome]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-welcome-recent]')).toBeVisible();
  const rows = win.locator('[data-studio-v3-welcome-recent-item]');
  await expect(rows).toHaveCount(2);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // Click the first → loads it (scene becomes non-empty).
  await rows.first().click();
  await win.waitForTimeout(400);

  // eslint-disable-next-line no-console
  console.log('  slice 539: welcome lists 2 recent files + clicked first');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
