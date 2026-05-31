import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-edit-mode-hotkeys');

test('Studio — Blender 1/2/3 edit-mode hotkeys (slice 380)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 500,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await expect(win.locator('[data-studio-edit-mode-chip="object"]')).toBeVisible({ timeout: 10000 });

  // Need a mesh for any of this to matter visually.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);

  // From object: 1/2/3 should NOT flip edit mode (they pass through).
  await win.keyboard.press('1');
  await win.waitForTimeout(150);
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('object');

  // Flip to vertex via the chip.
  await win.locator('[data-studio-edit-mode-chip="vertex"]').click();
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('vertex');

  // Now 2 → edge.
  await win.keyboard.press('2');
  await win.waitForTimeout(150);
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('edge');
  await expect(win.locator('[data-studio-edit-mode-chip="edge"]'))
    .toHaveAttribute('data-studio-edit-mode-active', '1');

  // 3 → face.
  await win.keyboard.press('3');
  await win.waitForTimeout(150);
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('face');

  // 1 → vertex.
  await win.keyboard.press('1');
  await win.waitForTimeout(150);
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('vertex');

  // Switch back to object so the rest of the suite isn't polluted.
  await win.locator('[data-studio-edit-mode-chip="object"]').click();

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 380: 1/2/3 flip edit-mode only when in sub-object mode');

  await app.close();
});
