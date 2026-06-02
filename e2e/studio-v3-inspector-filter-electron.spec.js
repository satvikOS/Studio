import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-inspector-filter');

test('Studio V3 — inspector filter hides non-matching sections (slice 546)', async () => {
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
  await win.waitForTimeout(500);

  const totalSectionsBefore = await win.locator('[data-studio-v3-right] .studio-right-section').count();
  expect(totalSectionsBefore).toBeGreaterThan(5);

  // Filter to "snap" — only Snap section should remain visible.
  await win.locator('[data-studio-v3-inspector-filter]').fill('snap');
  await win.waitForTimeout(200);

  const visible = await win.evaluate(() => {
    const all = document.querySelectorAll('[data-studio-v3-right] .studio-right-section');
    let n = 0;
    for (const s of all) {
      if (s.hasAttribute('data-studio-v3-filter-bar')) continue;
      if (window.getComputedStyle(s).display !== 'none') n++;
    }
    return n;
  });
  expect(visible).toBe(1); // Snap

  // Clear filter via Escape.
  await win.locator('[data-studio-v3-inspector-filter]').click();
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
  const visibleAll = await win.evaluate(() => {
    const all = document.querySelectorAll('[data-studio-v3-right] .studio-right-section');
    let n = 0;
    for (const s of all) {
      if (s.hasAttribute('data-studio-v3-filter-bar')) continue;
      if (window.getComputedStyle(s).display !== 'none') n++;
    }
    return n;
  });
  expect(visibleAll).toBeGreaterThan(3);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 546: inspector filter "snap" →', visible, 'visible · clear →', visibleAll);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
