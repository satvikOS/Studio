import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-archie-last-response');

test('Studio — Archie portal shows last-response peek (slice 340)', async () => {
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

  // Last-response peek absent initially (aiLog empty).
  await expect(win.locator('[data-studio-archie-last-response]')).toHaveCount(0);

  // Type a prompt + run.
  const inp = win.locator('[data-studio-archie-input]');
  await inp.click();
  await inp.press('ControlOrMeta+A');
  await inp.type('add a cube');
  await win.waitForTimeout(150);
  await win.locator('[data-studio-archie-run]').click();
  // Wait for the run to complete (the toast / log update happens after the
  // last plan step + a settle tick).
  await win.waitForTimeout(3000);

  // Peek now visible with at least 1 action recorded.
  await expect(win.locator('[data-studio-archie-last-response]')).toBeVisible();
  const actionCount = await win.locator('[data-studio-archie-last-response]').getAttribute('data-studio-archie-last-actions');
  expect(Number(actionCount)).toBeGreaterThanOrEqual(1);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 340: Archie last-response peek visible, actions=', actionCount);

  await app.close();
});
