import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-render-queue');

test('Studio V3 — Render queue enqueue + run (slice 580)', async () => {
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
    window.localStorage.removeItem('studio.v3.cameraBookmarks');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Seed 2 bookmarks.
  await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    c.position.set(0.5, 0.5, 0.5); c.updateMatrixWorld(true);
    window.__studioBookmarkCamera('alpha');
    c.position.set(1.5, 0.5, 0.5); c.updateMatrixWorld(true);
    window.__studioBookmarkCamera('beta');
  });

  // Stub <a>.click() so the render's PNG downloads don't pop OS dialogs.
  await win.evaluate(() => {
    window.__downloads = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { window.__downloads.push({ href: this.href, download: this.download }); };
    window.__restoreClick = () => { HTMLAnchorElement.prototype.click = orig; };
  });

  await win.evaluate(() => window.dispatchEvent(new CustomEvent('studio-render-queue-toggle')));
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-render-queue]')).toBeVisible();

  await win.locator('[data-studio-v3-render-queue-add-bookmarks]').click();
  await win.waitForTimeout(200);
  let rows = await win.locator('[data-studio-v3-render-queue-row]').count();
  expect(rows).toBe(2);

  await win.locator('[data-studio-v3-render-queue-add-current]').click();
  await win.waitForTimeout(200);
  rows = await win.locator('[data-studio-v3-render-queue-row]').count();
  expect(rows).toBe(3);

  // Run the queue.
  await win.locator('[data-studio-v3-render-queue-run]').click();
  await win.waitForTimeout(800);

  const dls = await win.evaluate(() => window.__downloads.length);
  expect(dls).toBeGreaterThanOrEqual(3);

  // Queue cleared after run.
  const remaining = await win.evaluate(() => window.__studioListRenderQueue().length);
  expect(remaining).toBe(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 580: queue 3 jobs · downloads', dls);

  await win.evaluate(() => {
    window.__restoreClick && window.__restoreClick();
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
