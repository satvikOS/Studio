import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-archie-suggestions');

test('Studio — Archie suggestion chips load prompts (slice 342)', async () => {
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

  // Suggestion strip visible at startup (aiLog empty).
  await expect(win.locator('[data-studio-archie-suggestions]')).toBeVisible();
  // 4 chips.
  const count = await win.locator('[data-studio-archie-suggestion]').count();
  expect(count).toBe(4);

  // Click the "frame all" chip — its text loads into the input.
  await win.locator('[data-studio-archie-suggestion="frame all"]').click();
  await win.waitForTimeout(200);
  const inputValue = await win.locator('[data-studio-archie-input]').inputValue();
  expect(inputValue).toBe('frame all');

  // Run the prompt → log entry → suggestion chips hide.
  await win.locator('[data-studio-archie-run]').click();
  await win.waitForTimeout(3000);
  await expect(win.locator('[data-studio-archie-suggestions]')).toHaveCount(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 342: suggestion chips load → run → hide');

  await app.close();
});
