import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-header-menu');

test('Studio — top header menu strip (View / Add / Object) (slice 328)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 700,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Menubar visible with 3 buttons.
  await expect(win.locator('[data-studio-header-menubar]')).toBeVisible();
  for (const m of ['view', 'add', 'object']) {
    await expect(win.locator(`[data-studio-header-menu-btn="${m}"]`)).toBeVisible();
  }

  // Open Add menu → click Cube → menu closes + cube spawned.
  await win.locator('[data-studio-header-menu-btn="add"]').click();
  await expect(win.locator('[data-studio-header-menu-panel="add"]')).toBeVisible();
  await expect(win.locator('[data-studio-header-menu-item="cube"]')).toBeVisible();
  await win.locator('[data-studio-header-menu-item="cube"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-header-menu-panel="add"]')).toHaveCount(0);
  const hasCube = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') n++; });
    return n;
  });
  expect(hasCube).toBeGreaterThanOrEqual(1);

  // Open View menu → click axis-top → camera Y high.
  await win.locator('[data-studio-header-menu-btn="view"]').click();
  await expect(win.locator('[data-studio-header-menu-panel="view"]')).toBeVisible();
  await win.locator('[data-studio-header-menu-item="axis-top"]').click();
  await win.waitForTimeout(300);
  expect(await win.evaluate(() => window.__studioCameraAxis)).toBe('top');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 328: header menus — Add→Cube spawned, View→Top set camera');

  await app.close();
});
