import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-status-tool');

test('Studio — status bar shows current tool (slice 372)', async () => {
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

  await expect(win.locator('[data-studio-status-tool]')).toBeVisible();
  await expect(win.locator('[data-studio-status-tool]')).toHaveAttribute('data-studio-status-tool-id', 'select');

  // Click the Move tool in the viewport header.
  await win.locator('[data-studio-tshelf-tool="move"]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-status-tool]')).toHaveAttribute('data-studio-status-tool-id', 'move');

  await win.locator('[data-studio-tshelf-tool="rotate"]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-status-tool]')).toHaveAttribute('data-studio-status-tool-id', 'rotate');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 372: status tool tracks select → move → rotate');

  await app.close();
});
