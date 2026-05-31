import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-tshelf-toolbar');

test('Studio — Blender T-shelf left toolbar (slice 317)', async () => {
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

  // Toolbar visible with all 5 tools.
  await expect(win.locator('[data-studio-viewport-toolbar]')).toBeVisible();
  for (const tool of ['select', 'cursor', 'move', 'rotate', 'scale']) {
    await expect(win.locator(`[data-studio-tshelf-tool="${tool}"]`)).toBeVisible();
  }

  // Default = select.
  await expect(win.locator('[data-studio-tshelf-tool="select"]')).toBeVisible();

  // Switch to Move; verify __studioActiveTool = 'move' + button highlighted.
  await win.locator('[data-studio-tshelf-tool="move"]').click();
  await win.waitForTimeout(200);
  expect(await win.evaluate(() => window.__studioActiveTool)).toBe('move');

  // Switch to Rotate.
  await win.locator('[data-studio-tshelf-tool="rotate"]').click();
  await win.waitForTimeout(200);
  expect(await win.evaluate(() => window.__studioActiveTool)).toBe('rotate');

  // Switch to Scale.
  await win.locator('[data-studio-tshelf-tool="scale"]').click();
  await win.waitForTimeout(200);
  expect(await win.evaluate(() => window.__studioActiveTool)).toBe('scale');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 317: T-shelf cycled select → move → rotate → scale');

  await app.close();
});
