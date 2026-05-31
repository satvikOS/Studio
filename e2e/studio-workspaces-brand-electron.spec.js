import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-workspaces-brand');

test('Studio — workspaces strip restyled to Studio brand (slice 338)', async () => {
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

  // Workspaces strip background = #0d1117.
  const stripBg = await win.evaluate(() => {
    const el = document.querySelector('.blender-workspaces-strip');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  expect(stripBg).toContain('rgb(13, 17, 23)');

  // Active workspace tab border-top = teal #1de9b6.
  const activeBorder = await win.evaluate(() => {
    const el = document.querySelector('.blender-workspace-tab.active');
    return el ? getComputedStyle(el).borderTopColor : null;
  });
  expect(activeBorder).toContain('rgb(29, 233, 182)');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 338: workspaces strip on Studio palette + teal active underline');

  await app.close();
});
