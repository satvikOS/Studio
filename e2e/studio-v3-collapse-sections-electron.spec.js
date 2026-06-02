import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-collapse-sections');

test('Studio V3 — inspector sections collapse on title click (slice 525)', async () => {
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
    window.localStorage.removeItem('studio.v3.collapsed-sections');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(500);

  // Find the World section + capture its child count.
  await expect(win.locator('[data-studio-v3-world-section]')).toBeVisible();
  const beforeChildrenVisible = await win.evaluate(() => {
    const sec = document.querySelector('[data-studio-v3-world-section]');
    if (!sec) return 0;
    let n = 0;
    for (const c of sec.children) {
      if (c.classList && c.classList.contains('studio-right-section-title')) continue;
      const s = window.getComputedStyle(c);
      if (s.display !== 'none') n++;
    }
    return n;
  });
  expect(beforeChildrenVisible).toBeGreaterThan(0);

  // Click the World title.
  await win.locator('[data-studio-v3-world-section] .studio-right-section-title').click();
  await win.waitForTimeout(300);

  const afterChildrenVisible = await win.evaluate(() => {
    const sec = document.querySelector('[data-studio-v3-world-section]');
    if (!sec) return 0;
    let n = 0;
    for (const c of sec.children) {
      if (c.classList && c.classList.contains('studio-right-section-title')) continue;
      const s = window.getComputedStyle(c);
      if (s.display !== 'none') n++;
    }
    return n;
  });
  expect(afterChildrenVisible).toBe(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // Reload — collapse persists.
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(900);
  const stillCollapsed = await win.evaluate(() => {
    const sec = document.querySelector('[data-studio-v3-world-section]');
    if (!sec) return 1;
    let n = 0;
    for (const c of sec.children) {
      if (c.classList && c.classList.contains('studio-right-section-title')) continue;
      const s = window.getComputedStyle(c);
      if (s.display !== 'none') n++;
    }
    return n;
  });
  expect(stillCollapsed).toBe(0);

  // eslint-disable-next-line no-console
  console.log('  slice 525: collapse persisted', beforeChildrenVisible, '→ 0 → 0');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
