import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-keypress-flash');

test('Studio V3 — keypress flash overlay opt-in (slice 558)', async () => {
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
    // Pre-enable keypress flash + keep other display toggles default.
    window.localStorage.setItem('studio.v3.display-toggles', JSON.stringify({
      grid: true, minimap: true, watermark: true, 'archie-status': true, keypress: true,
    }));
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(900);

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  await win.keyboard.press('Meta+Shift+S');
  await win.waitForTimeout(150);

  const flash = win.locator('[data-studio-v3-keypress]');
  await expect(flash).toBeVisible();
  const txt = await flash.getAttribute('data-studio-v3-keypress-text');
  expect(txt).toMatch(/Cmd/);
  expect(txt).toMatch(/Shift/);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // After 1.4 s it fades.
  await win.waitForTimeout(1400);
  await expect(win.locator('[data-studio-v3-keypress]')).toHaveCount(0);

  // eslint-disable-next-line no-console
  console.log('  slice 558: keypress flash showed', txt);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
