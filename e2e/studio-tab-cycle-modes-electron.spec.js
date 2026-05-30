import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-tab-cycle-modes');

test('Studio — Tab cycles through every Blender mode (slice 271)', async () => {
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

  const cycle = ['Object Mode', 'Edit Mode', 'Sculpt Mode', 'Vertex Paint',
                 'Weight Paint', 'Texture Paint', 'Pose Mode'];

  const mode = win.locator('[data-studio-viewport-mode]');
  await expect(mode).toHaveAttribute('data-studio-viewport-mode', 'Object Mode');
  for (let i = 1; i < cycle.length; i++) {
    await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    await win.waitForTimeout(150);
    await expect(mode).toHaveAttribute('data-studio-viewport-mode', cycle[i]);
  }
  // Wrap around.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
  await expect(mode).toHaveAttribute('data-studio-viewport-mode', 'Object Mode');
  await win.screenshot({ path: path.join(OUT, '00-back-to-object.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 271: Tab cycles 7-mode wheel + wraps');

  await app.close();
});
