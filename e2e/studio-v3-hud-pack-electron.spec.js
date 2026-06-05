import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-hud-pack');

test('Studio V3 — HUD overlays: badge/flash/watermark/stats/list/clear (slice 664)', async () => {
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

  // 1: badge
  const b = await win.evaluate(() => window.__studioHudAddBadge('LIVE'));
  expect(b.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-badge.png') });

  // 2: flash message — auto-dismisses
  const f = await win.evaluate(() => window.__studioHudFlashMessage('Saved', 600));
  expect(f.ok).toBe(true);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-flash.png') });

  // 3: watermark
  const w = await win.evaluate(() => window.__studioHudWatermark('archdisc Studio'));
  expect(w.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-watermark.png') });

  // Need a mesh so stats reports something
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(150);

  // 4: corner stats — element should appear
  const cs = await win.evaluate(() => window.__studioHudCornerStats());
  expect(cs.ok).toBe(true);
  await win.waitForTimeout(600);
  const csVisible = await win.locator('[data-studio-hud-stats]').isVisible();
  expect(csVisible).toBe(true);
  await win.screenshot({ path: path.join(OUT, '04-stats.png') });

  // 5: list
  const list = await win.evaluate(() => window.__studioHudList());
  expect(list.count).toBeGreaterThanOrEqual(3);
  expect(list.items.map((i) => i.kind)).toEqual(expect.arrayContaining(['badge', 'watermark', 'stats']));
  await win.screenshot({ path: path.join(OUT, '05-list.png') });

  // 6: clear all
  const cl = await win.evaluate(() => window.__studioHudClearAll());
  expect(cl.ok).toBe(true);
  expect(cl.removed).toBeGreaterThan(0);
  const after = await win.evaluate(() => window.__studioHudList());
  expect(after.count).toBe(0);
  await win.screenshot({ path: path.join(OUT, '06-clear.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 664: 6 HUD features verified — cleared', cl.removed, 'overlays');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
