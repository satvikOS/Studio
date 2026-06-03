import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-quad-view');

test('Studio V3 — Quad view overlay paints 3 thumbnails (slice 578)', async () => {
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
  await win.waitForTimeout(200);

  await win.evaluate(() => window.dispatchEvent(new CustomEvent('studio-quad-view-toggle')));
  await win.waitForTimeout(900); // wait for at least one refresh

  await expect(win.locator('[data-studio-v3-quad-view]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-quad-cell="top"]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-quad-cell="front"]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-quad-cell="right"]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-quad-cell="persp"]')).toBeVisible();

  // Each thumbnail img should have a populated data: src.
  for (const k of ['top', 'front', 'right']) {
    const src = await win.locator(`[data-studio-v3-quad-img="${k}"]`).getAttribute('src');
    expect(src).toMatch(/^data:image/);
  }

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 578: quad view cells painted');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
