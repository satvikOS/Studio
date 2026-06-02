import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-toast-bus');

test('Studio V3 — toast bus renders dispatched messages (slice 496)', async () => {
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
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Op surface present.
  expect(await win.evaluate(() => typeof window.__studioToast === 'function')).toBe(true);

  // Fire 2 toasts.
  await win.evaluate(() => { window.__studioToast('Cube added', 'ok'); window.__studioToast('Snap on', 'info'); });
  await win.waitForTimeout(200);

  const toasts = win.locator('[data-studio-v3-toast]');
  await expect(toasts).toHaveCount(2);
  await expect(toasts.first()).toContainText(/Cube added|Snap on/);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // After 2.8 s they auto-dismiss.
  await win.waitForTimeout(2800);
  await expect(win.locator('[data-studio-v3-toast]')).toHaveCount(0);

  // Snap toggle fires a toast via api wrapper.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => window.__studioToggleSnap && window.__studioToggleSnap());
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-toast]').first()).toContainText(/Snap/);

  // eslint-disable-next-line no-console
  console.log('  slice 496: toast bus renders + auto-dismisses');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
