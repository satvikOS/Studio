import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 220: Shift+R repeats the last op (Blender Repeat Last).
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-repeat-last');

test('Studio — Shift+R re-fires the last primitive spawn', async () => {
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

  // Spawn cube via ribbon click → records last op.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  expect(await win.evaluate(() => window.__studioLastOp && window.__studioLastOp.id)).toBe('cube');

  // Shift+R two times → two more cubes.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', shiftKey: true, bubbles: true })));
  await win.waitForTimeout(400);
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', shiftKey: true, bubbles: true })));
  await win.waitForTimeout(400);
  const n = await win.evaluate(() => {
    let c = 0;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') c++;
    });
    return c;
  });
  expect(n, '1 + 2 = 3 cubes').toBe(3);
  await win.screenshot({ path: path.join(OUT, '00-three-cubes.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 220: Shift+R repeat-last working');

  await app.close();
});
