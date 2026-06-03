import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-script-editor');

test('Studio V3 — Cmd+Shift+J script editor runs JS (slice 584)', async () => {
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

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await win.keyboard.press('Meta+Shift+j');
  await win.waitForTimeout(250);

  await expect(win.locator('[data-studio-v3-script-editor]')).toBeVisible();

  // Replace the script with one that returns a known value.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-script-code]');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, 'return 6 * 7;');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await win.locator('[data-studio-v3-script-run]').click();
  await win.waitForTimeout(200);

  const out = await win.locator('[data-studio-v3-script-result="0"]').textContent();
  expect(out.trim()).toBe('42');

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 584: script editor → 42');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
