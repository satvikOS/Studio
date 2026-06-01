import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-save-hotkey');

test('Studio V3 — Cmd+S triggers scene download (slice 438)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioDownloadScene === 'function', null, { timeout: 15000 });

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Spawn cube so there's something to save.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // Stub the download anchor so the test doesn't actually trigger a
  // browser download dialog. Track that the click fired.
  await win.evaluate(() => {
    window.__downloadFired = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) window.__downloadFired = this.download;
      return orig.apply(this, arguments);
    };
  });

  // Press Cmd+S.
  await win.keyboard.press('Meta+s');
  await win.waitForTimeout(200);

  const fired = await win.evaluate(() => window.__downloadFired);
  expect(fired).toBeTruthy();
  expect(fired).toMatch(/\.studio\.json$/);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 438: Cmd+S triggered download with name ', fired);

  await app.close();
});
