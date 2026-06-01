import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-timeline');

test('Studio V3 — timeline strip click-to-scrub (slice 444)', async () => {
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
  await win.waitForTimeout(500);

  // Timeline strip is visible.
  const strip = win.locator('[data-studio-v3-timeline]');
  await expect(strip).toBeVisible();

  // Reset to frame 0.
  await win.evaluate(() => window.__studioSetFrame(0));
  await win.waitForTimeout(100);
  await expect(strip).toHaveAttribute('data-studio-v3-frame', '0');

  // Click roughly at the middle of the strip → frame ≈ 30 of 60.
  const box = await strip.boundingBox();
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await win.waitForTimeout(300);
  const mid = await win.evaluate(() => window.__studioGetFrame());
  expect(mid).toBeGreaterThanOrEqual(25);
  expect(mid).toBeLessThanOrEqual(35);

  // Double-click → back to 0.
  await win.mouse.dblclick(box.x + box.width / 4, box.y + box.height / 2);
  await win.waitForTimeout(300);
  const reset = await win.evaluate(() => window.__studioGetFrame());
  expect(reset).toBe(0);

  // Keyframe dots — insert one at frame 12 and see it render.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
    window.__studioSetFrame(12);
    window.__studioInsertKeyframeAt(12);
  });
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-v3-keyframe="12"]')).toBeVisible();

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 444: timeline scrubs to', mid, ', double-click resets to', reset);

  await app.close();
});
