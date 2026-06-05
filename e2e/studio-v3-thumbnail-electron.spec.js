import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-thumbnail');

test('Studio V3 — thumbnails: gen/overview/all/get/list/clear (slice 671)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
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
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // 1: single thumbnail
  const t = await win.evaluate(() => window.__studioGenerateThumbnail(undefined, 256, 256));
  expect(t.ok).toBe(true);
  expect(t.dataUrl.startsWith('data:image/png')).toBe(true);
  expect(t.dataUrl.length).toBeGreaterThan(2000);
  await win.screenshot({ path: path.join(OUT, '01-thumb.png') });

  // 2: scene overview
  const ov = await win.evaluate(() => window.__studioGenerateSceneOverview(320, 200));
  expect(ov.ok).toBe(true);
  expect(ov.meshes).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '02-overview.png') });

  // 3: all thumbs
  const all = await win.evaluate(() => window.__studioGenerateAllThumbnails(128, 128));
  expect(all.ok).toBe(true);
  expect(all.generated).toBeGreaterThanOrEqual(2);
  await win.screenshot({ path: path.join(OUT, '03-all.png') });

  // 4: get cached
  const list = await win.evaluate(() => window.__studioListThumbnails());
  expect(list.count).toBeGreaterThanOrEqual(2);
  const first = await win.evaluate((u) => window.__studioGetThumbnailCache(u), list.uuids[0]);
  expect(first.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '04-get.png') });

  // 5: list
  await win.screenshot({ path: path.join(OUT, '05-list.png') });

  // 6: clear
  const cl = await win.evaluate(() => window.__studioClearThumbnailCache());
  expect(cl.ok).toBe(true);
  expect(cl.cleared).toBeGreaterThan(0);
  const after = await win.evaluate(() => window.__studioListThumbnails());
  expect(after.count).toBe(0);
  await win.screenshot({ path: path.join(OUT, '06-clear.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 671: 6 thumbnail features verified — generated', all.generated, 'overview', ov.dataUrl.length, 'b');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
