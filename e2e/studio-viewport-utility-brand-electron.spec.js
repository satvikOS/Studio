import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-viewport-utility-brand');

test('Studio — viewport utility buttons on Studio brand (slice 347)', async () => {
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

  for (const sel of [
    '[data-studio-viewport-gizmo-toggle]',
    '[data-studio-viewport-frame-all]',
    '[data-studio-viewport-screenshot]',
  ]) {
    await expect(win.locator(sel)).toBeVisible();
    const border = await win.evaluate((s) => {
      const el = document.querySelector(s);
      return el ? getComputedStyle(el).borderColor : null;
    }, sel);
    expect(border).toContain('rgb(33, 38, 45)'); // #21262d
  }

  await expect(win.locator('[data-studio-viewport-frame-all]')).toContainText('frame');
  await expect(win.locator('[data-studio-viewport-screenshot]')).toContainText('render');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 347: viewport utility buttons on Studio palette');

  await app.close();
});
