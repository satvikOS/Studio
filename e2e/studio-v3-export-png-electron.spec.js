import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-export-png');

test('Studio V3 — Cmd+Shift+E exports viewport PNG (slice 488)', async () => {
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

  // Spawn a cube so the render is not empty.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);

  // Op surface present.
  expect(await win.evaluate(() => typeof window.__studioExportViewportPNG === 'function')).toBe(true);

  // Direct call — verify the data-URL + name shape.
  const result = await win.evaluate(() => {
    // Stub the <a>.click() so the test isn't blocked by a real download dialog.
    const orig = HTMLAnchorElement.prototype.click;
    let captured = null;
    HTMLAnchorElement.prototype.click = function () { captured = { href: this.href, download: this.download }; };
    let res;
    try { res = window.__studioExportViewportPNG('test'); }
    finally { HTMLAnchorElement.prototype.click = orig; }
    return { res, captured };
  });

  expect(result.res.ok).toBe(true);
  expect(result.res.bytes).toBeGreaterThan(1000);
  expect(result.captured.href.startsWith('data:image/png;base64,')).toBe(true);
  expect(result.captured.download).toMatch(/test-.*\.png$/);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 488: PNG export', result.captured.download, '·', result.res.bytes, 'bytes');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
