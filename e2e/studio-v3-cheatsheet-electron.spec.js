import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-cheatsheet');

test('Studio V3 — F1 / ? keymap cheatsheet (slice 432)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Move focus off any text input.
  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Cheatsheet hidden by default.
  await expect(win.locator('[data-studio-v3-cheatsheet]')).toHaveCount(0);

  // F1 → opens.
  await win.keyboard.press('F1');
  await win.waitForTimeout(200);
  const sheet = win.locator('[data-studio-v3-cheatsheet]');
  await expect(sheet).toBeVisible();

  // Sections present.
  for (const s of ['Mode', 'Transform', 'Selection', 'View / Cmd']) {
    await expect(win.locator(`[data-studio-v3-cheatsheet-section="${s}"]`)).toBeVisible();
  }
  await expect(sheet).toContainText('Tab');
  await expect(sheet).toContainText('Cycle edit mode');

  // Esc closes.
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-cheatsheet]')).toHaveCount(0);

  // ? also toggles open.
  await win.keyboard.press('?');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-cheatsheet]')).toBeVisible();
  await win.keyboard.press('?');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-cheatsheet]')).toHaveCount(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 432: F1 + ? open cheatsheet, Esc + ? close it');

  await app.close();
});
