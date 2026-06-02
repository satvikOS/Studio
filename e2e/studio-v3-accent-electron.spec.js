import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-accent');

test('Studio V3 — custom accent color persists (slice 523)', async () => {
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
    window.localStorage.removeItem('studio.v3.accent');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Open settings.
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('studio-settings-toggle')));
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-settings]')).toBeVisible();

  // Set accent to a known color.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-settings-accent]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '#ff7a59');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.waitForTimeout(200);

  const applied = await win.evaluate(() => document.documentElement.style.getPropertyValue('--studio-accent'));
  expect(applied.toLowerCase()).toBe('#ff7a59');

  const stored = await win.evaluate(() => window.localStorage.getItem('studio.v3.accent'));
  expect(stored.toLowerCase()).toBe('#ff7a59');

  // Reload — survives.
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('studio-settings-toggle')));
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  const restored = await win.evaluate(() => document.documentElement.style.getPropertyValue('--studio-accent'));
  expect(restored.toLowerCase()).toBe('#ff7a59');

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 523: accent applied + persisted', restored);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
