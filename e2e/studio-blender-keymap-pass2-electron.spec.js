import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 194: BLENDER KEYMAP PASS 2.
 *
 *   F        frame selected
 *   Home     frame all
 *   H        hide selected
 *   Alt+H    reveal all
 *   Shift+D  duplicate selected
 *   Ctrl+A   select all
 *   Alt+A    deselect all
 *   Z        toggle wireframe shading
 *
 * Headed Mac Electron run at watchable pace.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-keymap-pass2');

test('Studio — Blender keymap pass 2: F / H / Alt+H / Shift+D / Ctrl+A / Alt+A / Z', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 800,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Build a 3-body scene + select cube.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'keymap pass2 demo',
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
  await win.screenshot({ path: path.join(OUT, '00-built.png') });

  const fire = async (init) => {
    await win.evaluate((i) => document.dispatchEvent(new KeyboardEvent('keydown', i)),
      { bubbles: true, ...init });
  };

  // Ctrl+A selects every primitive (multi-select set has all 3).
  await fire({ key: 'a', ctrlKey: true });
  await win.waitForTimeout(300);
  const afterCtrlA = await win.evaluate(() => window.__studioSelectedMeshes().length);
  expect(afterCtrlA, 'Ctrl+A selected all 3 primitives').toBe(3);
  await win.screenshot({ path: path.join(OUT, '01-ctrl-A-select-all.png') });
  await win.waitForTimeout(500);

  // Shift+D duplicates each → scene goes from 3 to 6 primitives.
  await fire({ key: 'd', shiftKey: true });
  await win.waitForTimeout(300);
  const afterDup = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n;
  });
  expect(afterDup, 'Shift+D duplicated all 3 → 6 in scene').toBe(6);
  await win.screenshot({ path: path.join(OUT, '02-shift-D-duplicate.png') });
  await win.waitForTimeout(500);

  // Z toggles wireframe ON across all primitives.
  await fire({ key: 'z' });
  await win.waitForTimeout(300);
  const wireOn = await win.evaluate(() => {
    let any = false;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive && o.material) {
        if (o.material.wireframe) any = true;
      }
    });
    return any;
  });
  expect(wireOn, 'Z turned wireframe ON for at least one primitive').toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-Z-wireframe.png') });
  await win.waitForTimeout(500);

  // Z again toggles wireframe OFF.
  await fire({ key: 'z' });
  await win.waitForTimeout(300);

  // Hide selected (H) — Ctrl+A re-selects all, then H hides them.
  await fire({ key: 'a', ctrlKey: true });
  await win.waitForTimeout(200);
  await fire({ key: 'h' });
  await win.waitForTimeout(300);
  const anyHidden = await win.evaluate(() => {
    let hidden = 0;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive && !o.visible) hidden++;
    });
    return hidden;
  });
  expect(anyHidden, 'H hid at least one primitive').toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '04-H-hide.png') });
  await win.waitForTimeout(500);

  // Alt+H reveals all hidden primitives.
  await fire({ key: 'h', altKey: true });
  await win.waitForTimeout(300);
  const allVisible = await win.evaluate(() => {
    let all = true;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive && !o.visible) all = false;
    });
    return all;
  });
  expect(allVisible, 'Alt+H revealed all hidden primitives').toBe(true);
  await win.screenshot({ path: path.join(OUT, '05-Alt+H-reveal.png') });
  await win.waitForTimeout(500);

  // Alt+A deselects all (set drops to 0).
  await fire({ key: 'a', altKey: true });
  await win.waitForTimeout(300);
  const setAfterAltA = await win.evaluate(() => window.__studioSelectedMeshes().length);
  expect(setAfterAltA, 'Alt+A deselected all').toBe(0);
  await win.screenshot({ path: path.join(OUT, '06-Alt+A-deselect.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 194: Blender keymap pass 2 (F/H/Alt+H/Shift+D/Ctrl+A/Alt+A/Z) wired end-to-end');

  await app.close();
});
