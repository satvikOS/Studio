import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-cheatsheet-filter');

test('Studio V3 — cheatsheet filter narrows rows (slice 526)', async () => {
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

  await win.keyboard.press('F1');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-cheatsheet]')).toBeVisible();

  const totalBefore = await win.locator('[data-studio-v3-cheatsheet-row]').count();
  expect(totalBefore).toBeGreaterThan(10);

  // Filter to "group".
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-cheatsheet-filter]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, 'group');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await win.waitForTimeout(200);

  const after = await win.locator('[data-studio-v3-cheatsheet-row]').count();
  expect(after).toBeLessThan(totalBefore);
  expect(after).toBeGreaterThanOrEqual(2); // Cmd+G + Cmd+Shift+G

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 526: cheatsheet rows', totalBefore, '→', after, '("group")');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
