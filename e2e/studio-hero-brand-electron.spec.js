import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-hero-brand');

test('Studio — empty-state hero card on Studio brand (slice 346)', async () => {
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

  await expect(win.locator('[data-studio-empty-hero][data-studio-brand="v2"]')).toBeVisible();
  const bg = await win.evaluate(() => {
    const el = document.querySelector('[data-studio-empty-hero]');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  expect(bg).toContain('rgb(13, 17, 23)');

  // Primary CTA "add cube" is teal background.
  const ctaBg = await win.evaluate(() => {
    const el = document.querySelector('[data-studio-hero-action="add-cube"]');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  expect(ctaBg).toContain('rgb(29, 233, 182)');

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // Click hides hero.
  await win.locator('[data-studio-hero-action="add-cube"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-empty-hero]')).toHaveCount(0);

  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 346: hero card on Studio palette + teal CTA');

  await app.close();
});
