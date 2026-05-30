import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 241: Shift+P parent / Alt+P unparent.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-parent');

test('Studio — Shift+P parents set to active; Alt+P unparents', async () => {
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
      goal: 'parent demo',
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

  // Build multi-select: select sphere first then add cube (cube
  // becomes active). Then Shift+P → sphere is parented to cube.
  const parentResult = await win.evaluate(() => {
    const scene = window.__archdiscScene;
    let cube = null, sphere = null;
    scene.traverse((o) => {
      const k = o.userData && o.userData.archdiscStudioPrimitiveKind;
      if (k === 'cube') cube = o; else if (k === 'sphere') sphere = o;
    });
    window.__studioSelectMesh(sphere);
    // Now add cube to set + make it active.
    selectedMeshesRef = null; // (cannot access ref from page scope)
    // Use the same shift+pointerdown trick as the multiselect spec.
    const cam = window.__archdiscViewport.camera;
    const rect = window.__archdiscViewport.renderer.domElement.getBoundingClientRect();
    const v = cube.position.clone().project(cam);
    const x = rect.left + (v.x * 0.5 + 0.5) * rect.width;
    const y = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
    window.__archdiscViewport.renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: x, clientY: y, button: 0, shiftKey: true, bubbles: true,
    }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', shiftKey: true, bubbles: true }));
    return {
      sphereParentKind: sphere.parent && sphere.parent.userData
        && sphere.parent.userData.archdiscStudioPrimitiveKind,
    };
  });
  expect(parentResult.sphereParentKind, 'sphere parented to cube').toBe('cube');
  await win.screenshot({ path: path.join(OUT, '00-parented.png') });

  // Alt+P unparents.
  await win.evaluate(() => {
    // Active selection is the cube; we want to unparent the sphere.
    let sphere = null;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') sphere = o;
    });
    window.__studioSelectMesh(sphere);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', altKey: true, bubbles: true }));
  });
  await win.waitForTimeout(300);
  const unparentedKind = await win.evaluate(() => {
    let s = null;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') s = o;
    });
    return s && s.parent && s.parent === window.__archdiscScene
      ? 'scene' : (s && s.parent && s.parent.type) || 'unknown';
  });
  expect(unparentedKind, 'sphere back under scene').toBe('scene');
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 241: parent / unparent working');

  await app.close();
});
