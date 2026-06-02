import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-view-menu');

test('Studio V3 — View menu fires camera axis change (slice 553)', async () => {
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

  const before = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return [c.position.x, c.position.y, c.position.z];
  });

  await win.locator('[data-studio-v3-menu="view"]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-view-menu]')).toBeVisible();

  // Click Top — camera should move to predominantly Y-up viewpoint.
  await win.locator('[data-studio-v3-view-action="top"]').click();
  await win.waitForTimeout(250);

  const after = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return [c.position.x, c.position.y, c.position.z];
  });
  // Y should now dominate (positive Y).
  expect(Math.abs(after[1])).toBeGreaterThan(Math.abs(after[0]));

  await expect(win.locator('[data-studio-v3-view-menu]')).toHaveCount(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 553: View→Top moved camera', before.map((n) => n.toFixed(2)).join(','), '→', after.map((n) => n.toFixed(2)).join(','));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
