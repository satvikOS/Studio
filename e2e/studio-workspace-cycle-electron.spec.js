import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 226: Ctrl+PageUp / Ctrl+PageDown cycle Blender workspaces.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-workspace-cycle');

test('Studio — Ctrl+PageDown advances to next workspace; Ctrl+PageUp returns', async () => {
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

  // Default is Layout.
  await expect(win.locator('[data-blender-workspace="Layout"]'))
    .toHaveAttribute('data-blender-workspace-active', '1');

  // Ctrl+PageDown -> next workspace = Modeling.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', ctrlKey: true, bubbles: true })));
  await win.waitForTimeout(400);
  await expect(win.locator('[data-blender-workspace="Modeling"]'))
    .toHaveAttribute('data-blender-workspace-active', '1');
  await win.screenshot({ path: path.join(OUT, '00-modeling.png') });

  // Again -> Sculpting.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', ctrlKey: true, bubbles: true })));
  await win.waitForTimeout(400);
  await expect(win.locator('[data-blender-workspace="Sculpting"]'))
    .toHaveAttribute('data-blender-workspace-active', '1');
  await win.screenshot({ path: path.join(OUT, '01-sculpting.png') });

  // Ctrl+PageUp twice -> back to Layout.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', ctrlKey: true, bubbles: true })));
  await win.waitForTimeout(400);
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', ctrlKey: true, bubbles: true })));
  await win.waitForTimeout(400);
  await expect(win.locator('[data-blender-workspace="Layout"]'))
    .toHaveAttribute('data-blender-workspace-active', '1');
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 226: workspace cycle working');

  await app.close();
});
