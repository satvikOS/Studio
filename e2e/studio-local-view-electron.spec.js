import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 209: Numpad / LOCAL VIEW toggle.
 *
 * Blender's Numpad-/ shortcut: pressing it isolates the selected
 * mesh(es), hiding everything else; pressing again restores the
 * full scene.
 *
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-local-view');

test('Studio — Numpad / isolates selection then restores', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 600,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // 3-body scene + select cube.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'local view demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'cube',         pos: [-0.07, 0, 0], scale: [1, 1, 1], color: '#9ab' },
        { kind: 'sphere',       pos: [ 0,    0, 0], scale: [1, 1, 1], color: '#c9a' },
        { kind: 'icosahedron',  pos: [ 0.07, 0, 0], scale: [1, 1, 1], color: '#ac9' },
      ],
      expect: { bodies: 3, kinds: ['cube', 'icosahedron', 'sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => {
    const s = window.__archdiscScene;
    let m = null;
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(300);

  // Press Numpad-/: only cube visible.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true })));
  await win.waitForTimeout(300);
  const isolated = await win.evaluate(() => {
    const vis = {};
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        const k = o.userData.archdiscStudioPrimitiveKind;
        vis[k] = o.visible;
      }
    });
    return vis;
  });
  expect(isolated.cube, 'cube visible in local view').toBe(true);
  expect(isolated.sphere, 'sphere hidden').toBe(false);
  expect(isolated.icosahedron, 'icosahedron hidden').toBe(false);
  await win.screenshot({ path: path.join(OUT, '00-isolated.png') });
  await win.waitForTimeout(700);

  // Press Numpad-/ again: all visible.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true })));
  await win.waitForTimeout(300);
  const restored = await win.evaluate(() => {
    const vis = {};
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        const k = o.userData.archdiscStudioPrimitiveKind;
        vis[k] = o.visible;
      }
    });
    return vis;
  });
  expect(restored.cube && restored.sphere && restored.icosahedron, 'all restored').toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-restored.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 209: Numpad / local view isolate + restore working');

  await app.close();
});
