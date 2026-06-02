import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-render-section');

test('Studio V3 — Render section exports custom-size PNG (slice 533)', async () => {
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
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);

  await expect(win.locator('[data-studio-v3-render-section]')).toBeVisible();

  // Click 720p preset → w=1280, h=720.
  await win.locator('[data-studio-v3-render-preset="720p"]').click();
  await win.waitForTimeout(100);

  // Stub <a>.click() to avoid OS download dialog.
  await win.evaluate(() => {
    window.__lastDownload = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { window.__lastDownload = { href: this.href, download: this.download }; };
    window.__restoreClick = () => { HTMLAnchorElement.prototype.click = orig; };
  });

  // Direct op invocation to verify dimensions independently.
  const r = await win.evaluate(() => window.__studioExportViewportPNG('test', 1280, 720));
  expect(r.ok).toBe(true);
  expect(r.width).toBe(1280);
  expect(r.height).toBe(720);

  // Render button on the panel.
  await win.locator('[data-studio-v3-render-go]').click();
  await win.waitForTimeout(300);
  const dl = await win.evaluate(() => window.__lastDownload);
  expect(dl).not.toBeNull();
  expect(dl.download).toMatch(/^render-.*\.png$/);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 533: render', r.width, '×', r.height, '· file', dl.download);

  await win.evaluate(() => {
    window.__restoreClick && window.__restoreClick();
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
