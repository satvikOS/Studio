import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-command-palette');

test('Studio V3 — Cmd+K command palette (slice 476)', async () => {
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

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Cmd+K opens palette.
  await win.keyboard.press('Meta+k');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-command-palette]')).toBeVisible();

  // Type "cube" → filters to spawn-cube + possibly others.
  await win.locator('[data-studio-v3-command-palette-input]').fill('cube');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-command-palette-item="spawn-cube"]')).toBeVisible();

  // Enter fires spawn-cube → scene grows.
  await win.locator('[data-studio-v3-command-palette-input]').press('Enter');
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-v3-command-palette]')).toHaveCount(0);
  const n = await win.evaluate(() => {
    let c = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) c++; });
    return c;
  });
  expect(n).toBeGreaterThanOrEqual(1);

  // Reopen and dismiss via Esc.
  await win.keyboard.press('Meta+k');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-command-palette]')).toBeVisible();
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-command-palette]')).toHaveCount(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 476: command palette filters, Enter fires, Esc dismisses');

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
