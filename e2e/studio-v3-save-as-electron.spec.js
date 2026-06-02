import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-save-as');

test('Studio V3 — Cmd+Shift+S opens save-as modal + commits name (slice 500)', async () => {
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

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Spawn so there's something to save.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // Cmd+Shift+S opens modal.
  await win.keyboard.press('Meta+Shift+s');
  await win.waitForTimeout(250);
  await expect(win.locator('[data-studio-v3-save-as]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-save-as-input]')).toBeFocused();

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // Type a custom name.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-save-as-input]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, 'my-render');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Stub anchor click so test isn't blocked by a real download dialog.
  await win.evaluate(() => {
    window.__lastDownload = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { window.__lastDownload = { href: this.href, download: this.download }; };
    window.__restoreClick = () => { HTMLAnchorElement.prototype.click = orig; };
  });

  await win.locator('[data-studio-v3-save-as-commit]').click();
  await win.waitForTimeout(250);

  const dl = await win.evaluate(() => window.__lastDownload);
  expect(dl).not.toBeNull();
  expect(dl.download).toMatch(/^my-render-.*\.studio\.json$/);

  // Modal dismissed.
  await expect(win.locator('[data-studio-v3-save-as]')).toHaveCount(0);

  // eslint-disable-next-line no-console
  console.log('  slice 500: save-as committed', dl.download);

  await win.evaluate(() => {
    window.__restoreClick && window.__restoreClick();
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
