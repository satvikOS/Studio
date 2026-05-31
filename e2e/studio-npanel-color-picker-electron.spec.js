import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-npanel-color-picker');

test('Studio — N-panel base color picker (slice 324)', async () => {
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

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);

  await expect(win.locator('[data-studio-npanel-color]')).toBeVisible();

  // Set color via input value + dispatch change (color input change is supported by fill).
  await win.locator('[data-studio-npanel-color]').fill('#ff3344');
  await win.waitForTimeout(200);

  const hex = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return m.material.color.getHexString();
  });
  expect(hex).toBe('ff3344');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 324: color picker set material.color to #ff3344');

  await app.close();
});
