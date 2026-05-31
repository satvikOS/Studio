import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-select-inverse');

test('Studio — Ctrl+I Invert Selection (slice 366)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSelectInverse === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Spawn 3 primitives.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="cone"]').click();
  await win.waitForTimeout(300);

  // Currently only the cone is selected (last spawn). Invert → cube + sphere = 2.
  const r1 = await win.evaluate(() => window.__studioSelectInverse());
  expect(r1.ok).toBe(true);
  expect(r1.count).toBe(2);

  // Invert again → cone = 1.
  const r2 = await win.evaluate(() => window.__studioSelectInverse());
  expect(r2.count).toBe(1);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 366: invert(1→2), invert again(2→1)');

  await app.close();
});
