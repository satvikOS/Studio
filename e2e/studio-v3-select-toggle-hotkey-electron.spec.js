import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-select-toggle');

test('Studio V3 — A toggles select-all / deselect-all (slice 431)', async () => {
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

  // Spawn 3 primitives.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(150);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(150);
  await win.locator('[data-studio-v3-tool="cone"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // Active selection after last spawn: cone selected (1).
  // Press A — current set is non-empty, so deselect.
  await win.keyboard.press('a');
  await win.waitForTimeout(150);
  let count = await win.evaluate(() => (window.__studioSelectedMeshes && window.__studioSelectedMeshes().length) || 0);
  expect(count).toBe(0);

  // Press A again — empty set, so select-all → 3.
  await win.keyboard.press('a');
  await win.waitForTimeout(150);
  count = await win.evaluate(() => (window.__studioSelectedMeshes && window.__studioSelectedMeshes().length) || 0);
  expect(count).toBe(3);

  // Press A again — non-empty, so deselect → 0.
  await win.keyboard.press('a');
  await win.waitForTimeout(150);
  count = await win.evaluate(() => (window.__studioSelectedMeshes && window.__studioSelectedMeshes().length) || 0);
  expect(count).toBe(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 431: A toggles select-all ↔ deselect-all (3 → 0 → 3 → 0)');

  await app.close();
});
