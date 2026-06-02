import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-watermark');

test('Studio V3 — viewport brand watermark is visible (slice 519)', async () => {
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
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  const wm = win.locator('[data-studio-v3-watermark]');
  await expect(wm).toHaveCount(1);
  await expect(wm).toContainText(/ArchDisc/);
  await expect(wm).toContainText(/Studio/);

  // Bottom-right placement: right edge of element close to viewport right.
  const box = await wm.boundingBox();
  const main = win.locator('[data-studio-v3-viewport]');
  const mb = await main.boundingBox();
  expect(box.x + box.width).toBeGreaterThan(mb.x + mb.width - 50);
  expect(box.y + box.height).toBeGreaterThan(mb.y + mb.height - 50);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 519: watermark anchored at', box.x.toFixed(0), box.y.toFixed(0));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
