import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-archie-log-declutter');

test('Studio — N-panel AI section decluttered to Archie Log (slice 341)', async () => {
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

  // Archie Log section present.
  await expect(win.locator('[data-studio-archie-log-section]')).toBeVisible();
  // Duplicate Run Prompt button removed.
  await expect(win.locator('[data-studio-action="run-ai-prompt"]')).toHaveCount(0);
  // Duplicate prompt input also removed.
  await expect(win.locator('input[data-studio-ai="prompt"]')).toHaveCount(0);
  // Empty-state hint visible.
  await expect(win.locator('[data-studio-archie-log-empty]')).toBeVisible();

  // After running through the portal, log entry appears.
  const inp = win.locator('[data-studio-archie-input]');
  await inp.click();
  await inp.press('ControlOrMeta+A');
  await inp.type('add a cube');
  await win.locator('[data-studio-archie-run]').click();
  await win.waitForTimeout(3000);

  // Empty-state hint gone; log has at least one entry.
  await expect(win.locator('[data-studio-archie-log-empty]')).toHaveCount(0);
  const runCount = await win.locator('[data-studio-ai-runs]').textContent();
  expect(runCount).toMatch(/\d+ run/);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 341: Archie Log decluttered N-panel — portal is the only prompt entry');

  await app.close();
});
