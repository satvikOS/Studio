import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-npanel-brand');

test('Studio — N-panel restyled to Studio brand (slice 337)', async () => {
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

  // N-panel uses Studio palette (#0d1117 chrome) + carries the brand attr.
  await expect(win.locator('[data-studio-npanel="open"][data-studio-brand="v2"]')).toBeVisible();
  const bg = await win.evaluate(() => {
    const el = document.querySelector('[data-studio-npanel="open"]');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  expect(bg).toContain('rgb(13, 17, 23)');

  // Active tab uses teal underline (#1de9b6).
  const tabBorder = await win.evaluate(() => {
    const el = document.querySelector('[data-studio-npanel-tab-active="1"]');
    return el ? getComputedStyle(el).borderBottomColor : null;
  });
  expect(tabBorder).toContain('rgb(29, 233, 182)');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 337: N-panel chrome migrated to Studio palette + teal active underline');

  await app.close();
});
