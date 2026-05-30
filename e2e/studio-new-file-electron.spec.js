import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 244: Ctrl+N New File.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-new-file');

test('Studio — Ctrl+N wipes the scene + resets cursor (with undo)', async () => {
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

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'new file demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'cube',   pos: [-0.06, 0, 0], scale: [1, 1, 1], color: '#9ab' },
        { kind: 'sphere', pos: [ 0.06, 0, 0], scale: [1, 1, 1], color: '#c9a' },
      ],
      expect: { bodies: 2, kinds: ['cube', 'sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => window.__studioSetCursor([0.1, 0.05, -0.05]));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true })));
  await win.waitForTimeout(400);

  const state = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return { count: n, cursor: window.__studioGetCursor() };
  });
  expect(state.count, 'scene cleared').toBe(0);
  expect(state.cursor).toEqual([0, 0, 0]);
  await win.screenshot({ path: path.join(OUT, '01-new.png') });

  // Ctrl+Z restores the scene from before Ctrl+N.
  await win.evaluate(() => window.__studioUndo());
  await win.waitForTimeout(400);
  const undone = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n;
  });
  expect(undone, 'undo restored 2 primitives').toBe(2);
  await win.screenshot({ path: path.join(OUT, '02-restored.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 244: Ctrl+N new + undo restore working');

  await app.close();
});
