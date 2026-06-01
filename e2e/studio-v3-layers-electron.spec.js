import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-layers');

test('Studio V3 — Layers tab toggle / solo / unsolo (slice 462)', async () => {
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

  await win.locator('[data-studio-v3-right-tab="layers"]').click();
  await win.waitForTimeout(200);

  // 8 layer rows.
  for (let i = 0; i < 8; i++) {
    await expect(win.locator(`[data-studio-v3-layer="${i}"]`)).toBeVisible();
  }

  // Layer 0 is on by default.
  await expect(win.locator('[data-studio-v3-layer="0"]'))
    .toHaveAttribute('data-studio-v3-layer-on', 'true');

  // Toggle layer 0 off.
  await win.locator('[data-studio-v3-layer-toggle="0"]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-layer="0"]'))
    .toHaveAttribute('data-studio-v3-layer-on', 'false');
  // Camera mask reflects.
  let bit0 = await win.evaluate(() => window.__archdiscViewport.camera.layers.mask & 1);
  expect(bit0).toBe(0);

  // Solo layer 2 → only layer 2 visible.
  await win.locator('[data-studio-v3-layer-solo="2"]').click();
  await win.waitForTimeout(200);
  const maskAfterSolo = await win.evaluate(() => window.__archdiscViewport.camera.layers.mask);
  // Bit 2 only.
  expect(maskAfterSolo).toBe(1 << 2);

  // Reveal all.
  await win.locator('[data-studio-v3-layer-unsolo]').click();
  await win.waitForTimeout(200);
  const restored = await win.evaluate(() => window.__archdiscViewport.camera.layers.mask & 1);
  // bit 0 should be the value PRIOR to solo (which we'd just toggled off).
  expect(restored).toBe(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 462: layers tab toggle / solo / unsolo cycle ok');

  await app.close();
});
