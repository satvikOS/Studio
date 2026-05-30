import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 205: PIVOT POINT MODES.
 *
 * Median (default — centroid of multi-selection), Individual (each
 * mesh in place), Cursor (3D Cursor from slice 197). Period key (.)
 * cycles through them. R / S transforms in the keymap respect the
 * active pivot.
 *
 * Headed Mac Electron run.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-pivot-mode');

test('Studio — pivot mode cycle + median R rotates around centroid', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetPivotMode === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Default pivot is 'median'.
  const initial = await win.evaluate(() => window.__studioGetPivotMode());
  expect(initial, 'default pivot is median').toBe('median');

  // Period (.) cycles median -> individual.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true })));
  await win.waitForTimeout(200);
  expect(await win.evaluate(() => window.__studioGetPivotMode())).toBe('individual');

  // Again -> cursor.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true })));
  await win.waitForTimeout(200);
  expect(await win.evaluate(() => window.__studioGetPivotMode())).toBe('cursor');

  // Again -> back to median.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true })));
  await win.waitForTimeout(200);
  expect(await win.evaluate(() => window.__studioGetPivotMode())).toBe('median');

  // Build a scene with cube at -0.06 and sphere at +0.06 (centroid 0).
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'pivot demo',
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
  await win.screenshot({ path: path.join(OUT, '00-scene.png') });

  // Select both meshes, then R (rotate +0.1 rad around median pivot at
  // origin). Median pivot moves each mesh in a circle around origin.
  // For cube at (-0.06, 0, 0), rotating 0.1 rad about Y at origin:
  //   new x = -0.06 * cos(0.1) - 0 * sin(0.1) = -0.06 * cos(0.1)
  //   new z = -0.06 * sin(0.1) + 0 * cos(0.1) =  0.06 * sin(0.1) wait...
  // The handler does: dx = m.x - pivot.x; dz = m.z - pivot.z;
  //                    m.x = pivot.x + (dx*c - dz*s); m.z = pivot.z + (dx*s + dz*c)
  // With pivot=[0,0,0], dx=-0.06, dz=0, c=cos(0.1), s=sin(0.1):
  //   m.x = -0.06*cos(0.1); m.z = -0.06*sin(0.1)
  const result = await win.evaluate(() => {
    const scene = window.__archdiscScene;
    const meshes = [];
    scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) meshes.push(o); });
    window.__studioSelectedMeshes && (function () {
      // Build multi-select set: cube + sphere
      window.__studioSelectMesh(meshes[0]); // sets set = [cube]
      // Now add sphere by dispatching a shift+pointerdown at its screen pos
      const cam = window.__archdiscViewport.camera;
      const rect = window.__archdiscViewport.renderer.domElement.getBoundingClientRect();
      const v = meshes[1].position.clone().project(cam);
      const x = rect.left + (v.x * 0.5 + 0.5) * rect.width;
      const y = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
      window.__archdiscViewport.renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: x, clientY: y, button: 0, shiftKey: true, bubbles: true,
      }));
    })();
    const before = meshes.map((m) => [m.position.x, m.position.z]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    const after = meshes.map((m) => [m.position.x, m.position.z]);
    return { before, after, set: window.__studioSelectedMeshes().length };
  });
  // eslint-disable-next-line no-console
  console.log('  pivot probe:', JSON.stringify(result));
  expect(result.set, 'multi-select has 2 meshes').toBe(2);
  // After median R, the cube and sphere should have moved (not just rotated in place).
  const cubeMoved = Math.abs(result.after[0][0] - result.before[0][0]) > 1e-6
                 || Math.abs(result.after[0][1] - result.before[0][1]) > 1e-6;
  expect(cubeMoved, 'cube position changed under median R').toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-after-median-R.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 205: pivot mode cycle + median rotation working');

  await app.close();
});
