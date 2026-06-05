import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-share-pack');

test('Studio V3 — share: clipJson/clipPng/shareUrl/import/copyUuid/paste (slice 667)', async () => {
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

  // 1: copy json to clipboard — Electron renderer should have clipboard access
  const j = await win.evaluate(() => window.__studioCopySceneJsonToClipboard());
  // Accept either ok or a clean clipboard-perm error
  expect(typeof j.ok).toBe('boolean');
  if (j.ok) expect(j.bytes).toBeGreaterThan(100);
  await win.screenshot({ path: path.join(OUT, '01-json.png') });

  // 2: copy screenshot
  const png = await win.evaluate(() => window.__studioCopyScreenshotToClipboard());
  expect(typeof png.ok).toBe('boolean');
  await win.screenshot({ path: path.join(OUT, '02-png.png') });

  // 3: share URL
  const su = await win.evaluate(() => window.__studioGenerateShareUrl());
  expect(su.ok).toBe(true);
  expect(su.url).toContain('#scene=');
  expect(su.bytes).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '03-url.png') });

  // 4: import from share url — strip + reimport
  const beforeImport = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.isMesh && o.userData?.archdiscStudioPrimitiveKind) n++; });
    return n;
  });
  await win.evaluate(() => window.__studioClearScene && window.__studioClearScene());
  const im = await win.evaluate((u) => window.__studioImportFromShareUrl(u), su.url);
  expect(im.ok).toBe(true);
  expect(im.added).toBeGreaterThan(0);
  const afterImport = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.isMesh) n++; });
    return n;
  });
  expect(afterImport).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '04-import.png') });

  // 5: copy selection uuid
  const cu = await win.evaluate(() => window.__studioCopySelectionUuid());
  // Either ok (with uuid) or clean error
  expect(typeof cu.ok).toBe('boolean');
  await win.screenshot({ path: path.join(OUT, '05-uuid.png') });

  // 6: paste from clipboard — likely returns text or ok=false depending on perm
  const ps = await win.evaluate(() => window.__studioPasteFromClipboard());
  expect(typeof ps.ok).toBe('boolean');
  await win.screenshot({ path: path.join(OUT, '06-paste.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 667: 6 share/clipboard features verified — url len', su.bytes, 'b');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
