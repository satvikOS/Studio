import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-open-hotkey');

test('Studio V3 — Cmd+O triggers file picker (slice 439)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioOpenSceneFile === 'function', null, { timeout: 15000 });

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Spy on HTMLInputElement.click — the picker dispatches one when invoked.
  await win.evaluate(() => {
    window.__pickerOpened = 0;
    const orig = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file' && this.accept && this.accept.includes('json')) {
        window.__pickerOpened++;
      }
      return orig.apply(this, arguments);
    };
  });

  await win.keyboard.press('Meta+o');
  await win.waitForTimeout(300);

  const n = await win.evaluate(() => window.__pickerOpened);
  expect(n).toBeGreaterThanOrEqual(1);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 439: Cmd+O opens picker — count=', n);

  await app.close();
});
