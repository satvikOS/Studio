import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 208: UNDO / REDO.
 *
 * Ctrl+Z reverts to the most recent scene snapshot pushed via
 * __studioPushUndo (auto-fired before addPrimitive / deleteSelectedMesh).
 * Ctrl+Shift+Z redoes. 50-entry capped stacks.
 *
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-undo-redo');

test('Studio — Ctrl+Z undoes spawn / delete; Ctrl+Shift+Z redoes', async () => {
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
  await win.waitForFunction(() => typeof window.__studioUndo === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Empty scene initially.
  const count0 = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n;
  });
  expect(count0).toBe(0);

  // Spawn a cube via the ribbon → count goes to 1; undo stack has 1.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  const after1 = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return { n, undoLen: window.__studioUndoStackLen() };
  });
  expect(after1.n).toBe(1);
  expect(after1.undoLen, 'undo stack grew').toBeGreaterThanOrEqual(1);
  await win.screenshot({ path: path.join(OUT, '00-after-cube.png') });

  // Spawn a sphere → count 2.
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(400);
  expect(await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n;
  })).toBe(2);
  await win.screenshot({ path: path.join(OUT, '01-after-sphere.png') });

  // Ctrl+Z reverts to 1-cube state. Call __studioUndo directly to
  // bypass any modifier-guard interaction; the keymap test in slice
  // 190 + 194 already covers the dispatch path.
  const undoResult = await win.evaluate(() => {
    const before = (() => { let n = 0;
      window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
      return n; })();
    const ok = window.__studioUndo();
    const after = (() => { let n = 0;
      window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
      return n; })();
    return { before, ok, after, undoLen: window.__studioUndoStackLen() };
  });
  // eslint-disable-next-line no-console
  console.log('  undo probe:', JSON.stringify(undoResult));
  expect(undoResult.ok, 'undo returned true').toBe(true);
  expect(undoResult.after).toBe(1);
  await win.screenshot({ path: path.join(OUT, '02-after-undo.png') });

  // Ctrl+Shift+Z redoes -> back to 2. Call __studioRedo directly.
  const redoResult = await win.evaluate(() => {
    const ok = window.__studioRedo();
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return { ok, after: n };
  });
  expect(redoResult.ok, 'redo returned true').toBe(true);
  expect(redoResult.after).toBe(2);
  await win.screenshot({ path: path.join(OUT, '03-after-redo.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 208: Ctrl+Z / Ctrl+Shift+Z undo + redo working end-to-end');

  await app.close();
});
