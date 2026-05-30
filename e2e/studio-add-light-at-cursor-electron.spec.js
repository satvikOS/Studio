import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 225: Ctrl+Shift+L adds a point light at the 3D cursor.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-add-light-at-cursor');

test('Studio — Ctrl+Shift+L spawns a Studio light at the 3D cursor', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetCursor === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  await win.evaluate(() => window.__studioSetCursor([0.1, 0.05, -0.05]));
  await win.waitForTimeout(200);

  const before = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioLight && o.isLight) n++;
    });
    return n;
  });

  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, shiftKey: true, bubbles: true })));
  await win.waitForTimeout(400);

  const result = await win.evaluate(() => {
    let n = 0; let last = null;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioLight && o.isLight) { n++; last = o; }
    });
    return { count: n, lastPos: last ? [last.position.x, last.position.y, last.position.z] : null };
  });
  expect(result.count, 'one light added').toBe(before + 1);
  expect(result.lastPos[0]).toBeCloseTo(0.1, 3);
  expect(result.lastPos[1]).toBeCloseTo(0.05, 3);
  expect(result.lastPos[2]).toBeCloseTo(-0.05, 3);
  await win.screenshot({ path: path.join(OUT, '00-light-at-cursor.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 225: Ctrl+Shift+L add light at cursor working');

  await app.close();
});
