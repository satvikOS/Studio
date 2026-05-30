import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 202: COLLAPSIBLE PROPERTIES PANEL.
 *
 * Click the chevron at the inner edge of the right Properties panel to
 * slide it off-screen and reclaim the viewport width. Click again to
 * restore. Mirrors Blender / Maya / Houdini's right-panel toggle.
 *
 * Headed Mac Electron run.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-properties-collapse');

test('Studio — Properties panel collapse / expand', async () => {
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
  await win.waitForTimeout(1500);

  const aside = win.locator('[data-studio-properties="studio"]');
  await expect(aside).toBeVisible();
  await expect(aside).toHaveAttribute('data-studio-properties-collapsed', '0');
  await win.screenshot({ path: path.join(OUT, '00-expanded.png') });
  await win.waitForTimeout(500);

  // Click the chevron toggle → collapsed.
  await win.evaluate(() => document.querySelector('[data-studio-properties-toggle]').click());
  await expect(aside).toHaveAttribute('data-studio-properties-collapsed', '1');
  await expect(win.locator('[data-studio-properties-toggle]'))
    .toHaveAttribute('aria-pressed', 'true');
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(OUT, '01-collapsed.png') });

  // The viewport keeps rendering (canvas dimensions unchanged or wider).
  const canvasW = await win.evaluate(() => document.querySelector('canvas').getBoundingClientRect().width);
  expect(canvasW, 'viewport canvas still rendered').toBeGreaterThan(800);

  // Click again to expand.
  await win.evaluate(() => document.querySelector('[data-studio-properties-toggle]').click());
  await expect(aside).toHaveAttribute('data-studio-properties-collapsed', '0');
  await win.screenshot({ path: path.join(OUT, '02-expanded-again.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 202: Properties panel collapse / expand working end-to-end');

  await app.close();
});
