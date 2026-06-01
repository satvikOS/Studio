import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-quick-add');

test('Studio V3 — Shift+A quick-add primitive menu (slice 457)', async () => {
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

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Shift+A opens the menu.
  await win.keyboard.press('Shift+a');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-quick-add]')).toBeVisible();
  for (const k of ['cube', 'sphere', 'plane', 'cylinder']) {
    await expect(win.locator(`[data-studio-v3-quick-add-item="${k}"]`)).toBeVisible();
  }

  // Click cube → 1 primitive in scene.
  await win.locator('[data-studio-v3-quick-add-item="cube"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-v3-quick-add]')).toHaveCount(0);
  const n = await win.evaluate(() => {
    let c = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) c++; });
    return c;
  });
  expect(n).toBe(1);

  // Re-open + Esc closes.
  await win.keyboard.press('Shift+a');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-quick-add]')).toBeVisible();
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-quick-add]')).toHaveCount(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 457: Shift+A opens menu, cube pick spawns, Esc closes');

  await app.close();
});
