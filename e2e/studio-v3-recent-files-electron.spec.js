import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-recent-files');

test('Studio V3 — saves push the recent-files list (slice 503)', async () => {
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
    window.localStorage.removeItem('archdisc.studio.recentFiles');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Spawn so save has content.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // Stub <a>.click() so download doesn't trigger the OS dialog.
  await win.evaluate(() => {
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    window.__restoreClick = () => { HTMLAnchorElement.prototype.click = orig; };
  });

  // Save 3 times under distinct names.
  await win.evaluate(() => window.__studioDownloadScene('alpha'));
  await win.waitForTimeout(50);
  await win.evaluate(() => window.__studioDownloadScene('bravo'));
  await win.waitForTimeout(50);
  await win.evaluate(() => window.__studioDownloadScene('charlie'));
  await win.waitForTimeout(100);

  const recent = await win.evaluate(() => window.__studioListRecentFiles());
  expect(recent.length).toBeGreaterThanOrEqual(3);
  // Newest first.
  expect(recent[0].name.startsWith('charlie-')).toBe(true);
  expect(recent[1].name.startsWith('bravo-')).toBe(true);
  expect(recent[2].name.startsWith('alpha-')).toBe(true);

  // Reload — list persists.
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(300);
  const recent2 = await win.evaluate(() => window.__studioListRecentFiles());
  expect(recent2.length).toBe(recent.length);

  // openRecentFile loads cached JSON back into the scene.
  // First clear the scene; then open the oldest "alpha".
  await win.evaluate(() => {
    const s = window.__archdiscScene;
    if (!s) return;
    const kids = s.children.slice();
    for (const c of kids) {
      if (c.userData && c.userData.archdiscStudioPrimitive) s.remove(c);
    }
  });
  const r = await win.evaluate((n) => window.__studioOpenRecentFile(n), recent2[2].name);
  expect(r.ok).toBe(true);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 503: recent files', recent2.map((it) => it.name).join(' / '));

  await win.evaluate(() => {
    window.__restoreClick && window.__restoreClick();
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
