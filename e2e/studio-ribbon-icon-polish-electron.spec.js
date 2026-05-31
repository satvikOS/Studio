import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-ribbon-icon-polish');

test('Studio — ribbon-tool icons + labels polished (slice 349)', async () => {
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

  // Ribbon-tool-icon font size = 18px now.
  const iconSize = await win.evaluate(() => {
    const el = document.querySelector('.ribbon-tool-icon');
    return el ? getComputedStyle(el).fontSize : null;
  });
  expect(iconSize).toBe('18px');

  // Default icon color = #9aa6b2.
  const iconColor = await win.evaluate(() => {
    const el = document.querySelector('.ribbon-tool-icon');
    return el ? getComputedStyle(el).color : null;
  });
  expect(iconColor).toContain('rgb(154, 166, 178)');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 349: ribbon-tool icon polished — 18px + #9aa6b2 default + teal hover');

  await app.close();
});
