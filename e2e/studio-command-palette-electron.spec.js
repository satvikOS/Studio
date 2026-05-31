import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-command-palette');

test('Studio — F3 / Cmd+P command palette (slice 325)', async () => {
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

  // Closed initially.
  await expect(win.locator('[data-studio-command-palette]')).toHaveCount(0);

  // Open via F3.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true })));
  await win.waitForTimeout(250);
  await expect(win.locator('[data-studio-command-palette]')).toBeVisible();

  // Type 'cube' → matching items appear.
  await win.locator('[data-studio-command-palette-input]').fill('cube');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-palette-item="cube"]')).toBeVisible();

  // Click the 'cube' item → palette closes + cube spawned.
  await win.locator('[data-studio-palette-item="cube"]').click();
  await win.waitForTimeout(600);
  const after = await win.evaluate(() => ({
    paletteOpen: !!document.querySelector('[data-studio-command-palette]'),
    cubeCount: (() => {
      let n = 0;
      window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') n++; });
      return n;
    })(),
  }));
  expect(after.cubeCount).toBeGreaterThanOrEqual(1);
  expect(after.paletteOpen).toBe(false);

  // Reopen and Escape closes.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true })));
  await win.waitForTimeout(150);
  await expect(win.locator('[data-studio-command-palette]')).toBeVisible();
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await win.waitForTimeout(150);
  await expect(win.locator('[data-studio-command-palette]')).toHaveCount(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 325: command palette opens via F3, dispatches cube, Esc closes');

  await app.close();
});
