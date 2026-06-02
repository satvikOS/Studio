import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-window-menu');

test('Studio V3 — Window menu switches right tab + resets layout (slice 554)', async () => {
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
    window.localStorage.setItem('studio.v3.rightWidth', '480');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-v3-menu="window"]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-window-menu]')).toBeVisible();

  // Pick "Right panel: Outliner".
  await win.locator('[data-studio-v3-window-action="panel-outliner"]').click();
  await win.waitForTimeout(200);

  await expect(win.locator('[data-studio-v3-right-tab="outliner"]')).toHaveAttribute('data-active', 'true');

  // Pick reset layout next.
  await win.locator('[data-studio-v3-menu="window"]').click();
  await win.waitForTimeout(150);
  await win.locator('[data-studio-v3-window-action="reset-layout"]').click();
  await win.waitForTimeout(150);

  const cleared = await win.evaluate(() => window.localStorage.getItem('studio.v3.rightWidth'));
  expect(cleared).toBeNull();

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 554: window menu switched tab + cleared layout key');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
