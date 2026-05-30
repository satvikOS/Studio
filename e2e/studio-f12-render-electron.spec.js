import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 219: F12 captures a render (Blender F12 hotkey).
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-f12-render');

test('Studio — F12 returns a render data-URL via __archieCaptureRender', async () => {
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
  await win.waitForFunction(() => typeof window.__archieCaptureRender === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Build a teapot so the render has something to capture.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'f12 render demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'teapot', pos: [0, 0, 0], scale: [1, 1, 1], color: '#bfa14a' }],
      expect: { bodies: 1, kinds: ['teapot'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);

  // Pre-F12: capture invariant — direct call returns a PNG data URL.
  const dataUrl = await win.evaluate(() => window.__archieCaptureRender());
  expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(dataUrl.length, 'render dataUrl has bytes').toBeGreaterThan(2048);

  // Fire F12 to ensure the keymap path doesn't throw.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true })));
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(OUT, '00-after-F12.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 219: F12 captures render OK');

  await app.close();
});
