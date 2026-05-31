import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-op-toast');

test('Studio — operator toast surfaces last action (slice 327)', async () => {
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

  // No toast initially.
  await expect(win.locator('[data-studio-op-toast]')).toHaveCount(0);

  // Spawn cube → __studioLastOp = {kind:'primitive', id:'cube'} → toast appears.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-op-toast]')).toBeVisible();
  await expect(win.locator('[data-studio-op-toast]')).toHaveAttribute('data-studio-op-toast-id', 'cube');

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // Wait for toast to fade.
  await win.waitForTimeout(3000);
  await expect(win.locator('[data-studio-op-toast]')).toHaveCount(0);

  // Spawn another primitive — toast reappears.
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-op-toast]')).toBeVisible();
  await expect(win.locator('[data-studio-op-toast]')).toHaveAttribute('data-studio-op-toast-id', 'sphere');

  await win.screenshot({ path: path.join(OUT, '01.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 327: op toast surfaced cube then sphere');

  await app.close();
});
