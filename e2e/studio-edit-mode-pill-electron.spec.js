import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-edit-mode-pill');

test('Studio — viewport-header edit-mode pill chips (slice 379)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 600,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await expect(win.locator('[data-studio-edit-mode-chip="object"]')).toBeVisible({ timeout: 10000 });

  // All 5 chips present.
  for (const id of ['object', 'vertex', 'edge', 'face', 'sculpt']) {
    await expect(win.locator(`[data-studio-edit-mode-chip="${id}"]`)).toBeVisible();
  }

  // Default → object is active.
  await expect(win.locator('[data-studio-edit-mode-chip="object"]'))
    .toHaveAttribute('data-studio-edit-mode-active', '1');

  // Click vertex → it becomes active, object goes inactive, mode flips.
  await win.locator('[data-studio-edit-mode-chip="vertex"]').click();
  await expect(win.locator('[data-studio-edit-mode-chip="vertex"]'))
    .toHaveAttribute('data-studio-edit-mode-active', '1');
  await expect(win.locator('[data-studio-edit-mode-chip="object"]'))
    .toHaveAttribute('data-studio-edit-mode-active', '0');
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('vertex');

  // Click face → face active.
  await win.locator('[data-studio-edit-mode-chip="face"]').click();
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('face');

  // Programmatic flip via __studioSetEditMode also updates UI (event-driven).
  await win.evaluate(() => window.__studioSetEditMode('edge'));
  await expect(win.locator('[data-studio-edit-mode-chip="edge"]'))
    .toHaveAttribute('data-studio-edit-mode-active', '1');

  await win.locator('[data-studio-edit-mode-chip="object"]').click();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 379: edit-mode pill chips drive + reflect __studioSetEditMode');

  await app.close();
});
