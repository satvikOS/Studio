import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-export-hotkey');

test('Studio V3 — Cmd+E exports scene as GLTF (slice 445)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioDownloadGLTF === 'function', null, { timeout: 15000 });

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Spawn cube so the GLTF has content.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // Stub the download anchor click to record the file name.
  await win.evaluate(() => {
    window.__exportFired = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && this.download.endsWith('.gltf')) window.__exportFired = this.download;
      return orig.apply(this, arguments);
    };
  });

  await win.keyboard.press('Meta+e');
  // GLTFExporter is async — wait for the export to complete.
  await win.waitForFunction(() => window.__exportFired != null, null, { timeout: 5000 });

  const fired = await win.evaluate(() => window.__exportFired);
  expect(fired).toMatch(/\.gltf$/);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 445: Cmd+E triggered GLTF export →', fired);

  await app.close();
});
