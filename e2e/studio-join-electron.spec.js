import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 214: Ctrl+J join selected meshes (Blender Object>Join).
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-join');

test('Studio — Ctrl+J merges multi-select into a single mesh', async () => {
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
      goal: 'join demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'cube',   pos: [-0.05, 0, 0], scale: [1, 1, 1], color: '#9ab' },
        { kind: 'sphere', pos: [ 0.05, 0, 0], scale: [1, 1, 1], color: '#c9a' },
      ],
      expect: { bodies: 2, kinds: ['cube', 'sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(OUT, '00-two.png') });

  // Ctrl+A selects all, Ctrl+J joins.
  await win.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true }));
  });
  await win.waitForTimeout(500);
  const state = await win.evaluate(() => {
    const kinds = [];
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        kinds.push(o.userData.archdiscStudioPrimitiveKind);
      }
    });
    return { count: kinds.length, kinds };
  });
  expect(state.count, '2 primitives merged into 1').toBe(1);
  expect(state.kinds[0], 'kind is joined').toBe('joined');
  await win.screenshot({ path: path.join(OUT, '01-joined.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 214: Ctrl+J join working');

  await app.close();
});
