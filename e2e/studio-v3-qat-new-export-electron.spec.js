import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-qat-new-export');

test('Studio V3 — QAT new clears scene + export button (slice 446)', async () => {
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
  await win.waitForTimeout(400);

  // QAT export button exists.
  await expect(win.locator('[data-studio-v3-qat-btn="export"]')).toBeVisible();

  // Spawn 2 primitives.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(150);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  let n = await win.evaluate(() => {
    let c = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) c++; });
    return c;
  });
  expect(n).toBe(2);

  // Click QAT new → scene clears to 0.
  await win.locator('[data-studio-v3-qat-btn="new"]').click();
  await win.waitForTimeout(300);
  n = await win.evaluate(() => {
    let c = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) c++; });
    return c;
  });
  expect(n).toBe(0);

  // Spawn one + click QAT export → triggers GLTF download.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    window.__exportFired = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && this.download.endsWith('.gltf')) window.__exportFired = this.download;
      return orig.apply(this, arguments);
    };
  });
  await win.locator('[data-studio-v3-qat-btn="export"]').click();
  await win.waitForFunction(() => window.__exportFired != null, null, { timeout: 5000 });
  const fired = await win.evaluate(() => window.__exportFired);
  expect(fired).toMatch(/\.gltf$/);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 446: QAT new clears scene, export downloads', fired);

  await app.close();
});
