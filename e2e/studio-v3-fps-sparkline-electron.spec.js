import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-fps-sparkline');

test('Studio V3 — FPS sparkline buffers samples (slice 495)', async () => {
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

  const spark = win.locator('[data-studio-v3-status="fps-spark"]');
  await expect(spark).toHaveCount(1);

  // After 2 seconds, expect at least 2 samples buffered (status bar polls
  // FPS at ~500 ms intervals → ~4 samples in 2 s).
  await win.waitForTimeout(2400);
  const samples = Number(await spark.getAttribute('data-studio-v3-spark-samples'));
  expect(samples).toBeGreaterThanOrEqual(2);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // SVG path inside the badge should be non-empty.
  const pathLen = await spark.locator('svg path').evaluate((p) => (p.getAttribute('d') || '').length);
  expect(pathLen).toBeGreaterThan(0);

  // eslint-disable-next-line no-console
  console.log('  slice 495: FPS sparkline buffered', samples, 'samples · path length', pathLen);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
