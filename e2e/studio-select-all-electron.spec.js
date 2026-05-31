import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-select-all');

test('Studio — __studioSelectAll selects every primitive (slice 365)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSelectAll === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Spawn 3 primitives.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="cone"]').click();
  await win.waitForTimeout(300);

  const r = await win.evaluate(() => window.__studioSelectAll());
  expect(r.ok).toBe(true);
  expect(r.count).toBe(3);

  // The multi-select set should now have all 3.
  const set = await win.evaluate(() => window.__studioSelectedMeshes && window.__studioSelectedMeshes().length);
  expect(set).toBe(3);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 365: select-all picked up', r.count, 'primitives');

  await app.close();
});
