import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-plugin-manager');

test('Studio V3 — Plugin manager install + persist + run (slice 574)', async () => {
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
    window.localStorage.removeItem('studio.v3.plugins');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Open the manager via the Window menu.
  await win.locator('[data-studio-v3-menu="window"]').click();
  await win.waitForTimeout(150);
  await win.locator('[data-studio-v3-window-action="plugin-manager"]').click();
  await win.waitForTimeout(200);

  await expect(win.locator('[data-studio-v3-plugin-manager]')).toBeVisible();

  // Type name + override the code to register a custom op.
  await win.locator('[data-studio-v3-plugin-name]').fill('my-test-op');
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-plugin-code]');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, 'window.__studioMyTestOp = () => 42;');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await win.locator('[data-studio-v3-plugin-install]').click();
  await win.waitForTimeout(200);

  // Registered op should exist.
  const v = await win.evaluate(() => (window.__studioMyTestOp && window.__studioMyTestOp()) || null);
  expect(v).toBe(42);

  // Persisted in localStorage.
  const stored = await win.evaluate(() => JSON.parse(window.localStorage.getItem('studio.v3.plugins') || '[]'));
  expect(stored.length).toBe(1);
  expect(stored[0].name).toBe('my-test-op');

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // Reload — plugin runs again automatically.
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);
  const v2 = await win.evaluate(() => (window.__studioMyTestOp && window.__studioMyTestOp()) || null);
  expect(v2).toBe(42);

  // eslint-disable-next-line no-console
  console.log('  slice 574: plugin installed + persisted across reload');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
