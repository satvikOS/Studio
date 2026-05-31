import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-property-section-brand');

test('Studio — property sections on Studio palette (slice 344)', async () => {
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

  // Property section background is #0d1117 (Studio chrome).
  const bg = await win.evaluate(() => {
    const el = document.querySelector('[data-studio-properties="studio"] .property-section');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  expect(bg).toContain('rgb(13, 17, 23)');
  // Section divider border-top = #1f2733.
  const borderTop = await win.evaluate(() => {
    const els = document.querySelectorAll('[data-studio-properties="studio"] .property-section');
    if (els.length < 2) return null;
    return getComputedStyle(els[1]).borderTopColor;
  });
  expect(borderTop).toContain('rgb(31, 39, 51)');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 344: property sections on Studio palette');

  await app.close();
});
