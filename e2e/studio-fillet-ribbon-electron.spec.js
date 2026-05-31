import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-fillet-ribbon');

test('Studio — Fillet ribbon button (slice 296)', async () => {
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

  // Spawn cube via ribbon Cube button, then click Fillet.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  const before = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { counter: m && m.userData.archdiscStudioFilleted || 0 };
  });

  await expect(win.locator('[data-studio-ribbon-action="fillet"]')).toBeVisible();
  await win.locator('[data-studio-ribbon-action="fillet"]').click();
  await win.waitForTimeout(400);

  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { counter: m.userData.archdiscStudioFilleted };
  });
  expect(after.counter).toBe(before.counter + 1);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 296: Fillet ribbon button bumped counter to', after.counter);

  await app.close();
});
