import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-rename-mesh');

test('Studio — N-panel rename selected mesh (slice 333)', async () => {
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

  await expect(win.locator('[data-studio-npanel-rename]')).toBeVisible();
  const inp = win.locator('[data-studio-npanel-rename]');
  await inp.click();
  await inp.press('ControlOrMeta+A');
  await inp.type('HeroCube');
  await win.waitForTimeout(250);

  const name = await win.evaluate(() => window.__studioSelectedMesh().name);
  expect(name).toBe('HeroCube');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 333: mesh renamed to', name);

  await app.close();
});
