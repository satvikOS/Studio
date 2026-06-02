import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-shading-status');

test('Studio V3 — status bar shading-mode indicator (slice 480)', async () => {
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
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  const ind = win.locator('[data-studio-v3-status="shading"]');
  await expect(ind).toBeVisible();
  await expect(ind).toHaveAttribute('data-studio-v3-shading-mode', 'solid');

  // Click → cycles to material.
  await ind.click();
  await win.waitForTimeout(200);
  await expect(ind).toHaveAttribute('data-studio-v3-shading-mode', 'material');

  // Programmatic SetShadingMode picks up in next poll.
  await win.evaluate(() => window.__studioSetShadingMode('wire'));
  await win.waitForTimeout(1200);
  await expect(ind).toHaveAttribute('data-studio-v3-shading-mode', 'wire');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 480: shading indicator click cycle solid → material → wire');

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
