import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 197: BLENDER 3D CURSOR.
 *
 * Iconic Blender positional anchor — a 3-axis crosshair rendered in
 * the scene at a settable world position. Programmatic API:
 *   __studioSetCursor([x,y,z])   set position
 *   __studioGetCursor()           read current position
 *   __studioSnapCursorOrigin()    snap to [0,0,0]   (Shift+C key)
 *   __studioSnapCursorSelection() snap to active mesh (Shift+S key)
 *
 * Headed Mac Electron run at watchable pace.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-3d-cursor');

test('Studio — 3D Cursor: set / get / Shift+C origin / Shift+S selection', async () => {
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

  // Set cursor at a known position; read back via __studioGetCursor.
  const set1 = await win.evaluate(() => window.__studioSetCursor([0.12, 0.05, -0.08]));
  expect(set1).toEqual([0.12, 0.05, -0.08]);
  const get1 = await win.evaluate(() => window.__studioGetCursor());
  expect(get1[0]).toBeCloseTo(0.12, 3);
  expect(get1[1]).toBeCloseTo(0.05, 3);
  expect(get1[2]).toBeCloseTo(-0.08, 3);

  // The cursor object exists in the scene as a tagged Group.
  const sceneTagged = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdisc3DCursor) n++; });
    return n;
  });
  expect(sceneTagged, '3D cursor group present in scene').toBe(1);
  await win.screenshot({ path: path.join(OUT, '00-cursor-offset.png') });
  await win.waitForTimeout(700);

  // Shift+C snaps cursor back to origin.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', shiftKey: true, bubbles: true })));
  await win.waitForTimeout(300);
  const afterShiftC = await win.evaluate(() => window.__studioGetCursor());
  expect(afterShiftC).toEqual([0, 0, 0]);
  await win.screenshot({ path: path.join(OUT, '01-shift-C-origin.png') });
  await win.waitForTimeout(700);

  // Build a body, select it, Shift+S snaps cursor to the selection's
  // origin (mesh position).
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: '3d cursor demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'sphere', pos: [0.06, 0.02, -0.03], scale: [1, 1, 1], color: '#c9a' },
      ],
      expect: { bodies: 1, kinds: ['sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  // Select the sphere.
  await win.evaluate(() => {
    const scene = window.__archdiscScene;
    let m = null;
    scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(300);
  // Shift+S snaps cursor to selection.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', shiftKey: true, bubbles: true })));
  await win.waitForTimeout(300);
  const afterShiftS = await win.evaluate(() => window.__studioGetCursor());
  expect(afterShiftS[0]).toBeCloseTo(0.06, 3);
  expect(afterShiftS[1]).toBeCloseTo(0.02, 3);
  expect(afterShiftS[2]).toBeCloseTo(-0.03, 3);
  await win.screenshot({ path: path.join(OUT, '02-shift-S-to-selection.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 197: 3D Cursor set / get / Shift+C origin / Shift+S selection working');

  await app.close();
});
