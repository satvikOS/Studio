import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-export-mesh');

test('Studio V3 — __studioExportOBJ + __studioExportSTL produce files (slice 548)', async () => {
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
  await win.waitForTimeout(300);

  await win.evaluate(() => {
    window.__lastDownload = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { window.__lastDownload = { href: this.href, download: this.download }; };
    window.__restoreClick = () => { HTMLAnchorElement.prototype.click = orig; };
  });

  const objR = await win.evaluate(() => window.__studioExportOBJ('cube'));
  expect(objR.ok).toBe(true);
  expect(objR.bytes).toBeGreaterThan(50);

  const objDl = await win.evaluate(() => window.__lastDownload);
  expect(objDl.download).toMatch(/cube-.*\.obj$/);

  const stlR = await win.evaluate(() => window.__studioExportSTL('cube'));
  expect(stlR.ok).toBe(true);
  expect(stlR.bytes).toBeGreaterThan(50);

  const stlDl = await win.evaluate(() => window.__lastDownload);
  expect(stlDl.download).toMatch(/cube-.*\.stl$/);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 548: OBJ', objR.bytes, 'B · STL', stlR.bytes, 'B');

  await win.evaluate(() => {
    window.__restoreClick && window.__restoreClick();
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
