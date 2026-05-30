import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 192: MULTI-SELECT (Shift+click + group G/R/S).
 *
 * Studio was single-select. This slice adds the multi-select set every
 * DCC tool (Blender, Maya, Houdini, ZBrush, Substance, etc.) ships:
 *
 *   - Shift+click on a mesh adds/removes it from the multi-select set
 *     (regular click replaces the set with just that mesh).
 *   - The Blender keymap's G / R / S now apply to ALL meshes in the
 *     set so grouped transforms work like Blender.
 *   - window.__studioSelectedMeshes() exposes the set (e2e + AI).
 *
 * Headed Mac Electron run.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-multiselect');

test('Studio — multi-select drives grouped G/R/S transforms', async () => {
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

  // Build a 3-body scene.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'multiselect demo',
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
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(OUT, '00-three-bodies.png') });

  // Build a multi-select set programmatically of cube + sphere via
  // direct manipulation of the multi-select ref. Records starting
  // positions, presses G three times (each mesh moves +0.15 X), then
  // confirms BOTH selected meshes moved while the third did not.
  const result = await win.evaluate(() => {
    const scene = window.__archdiscScene;
    let cube = null, sphere = null, ico = null;
    scene.traverse((o) => {
      const k = o.userData && o.userData.archdiscStudioPrimitiveKind;
      if (k === 'cube') cube = o;
      else if (k === 'sphere') sphere = o;
      else if (k === 'icosahedron') ico = o;
    });
    // Single-select cube first (this also seeds the multi-select set).
    window.__studioSelectMesh(cube);
    // Then Shift-style add sphere to the set by directly fetching the
    // set, pushing, and re-selecting cube to keep it active.
    // (Real users do this with Shift+click; programmatic equivalent here.)
    const set = window.__studioSelectedMeshes();
    if (!set.includes(sphere)) {
      // Use the same path: dispatch a pointerdown event isn't reliable
      // over the headed/remote stack. Instead, write to the multi-select
      // set the same way the pointer handler does, by exposing a tiny
      // setter for testability — but we don't have one, so we use the
      // archieEngine to read the dispatcher: the set is on the page,
      // so we modify it in place via __studioSelectMesh + a push.
      // Trick: __studioSelectMesh(mesh) collapses set to [mesh]. We
      // want [cube, sphere]. So we use the underlying ref through
      // window.__studioSelectedMeshes which returns a SLICE — no good.
      // Easier: dispatch a synthetic pointerdown with shiftKey to the
      // viewport at sphere's screen-space center.
      const cam = window.__archdiscViewport.camera;
      const rect = window.__archdiscViewport.renderer.domElement.getBoundingClientRect();
      const v = sphere.position.clone().project(cam);
      const x = rect.left + (v.x * 0.5 + 0.5) * rect.width;
      const y = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
      window.__archdiscViewport.renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: x, clientY: y, button: 0, shiftKey: true, bubbles: true,
      }));
    }
    const startCubeX  = cube.position.x;
    const startSphX   = sphere.position.x;
    const startIcoX   = ico.position.x;
    // Three G keys -> all set meshes move +0.05 each.
    for (let i = 0; i < 3; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
    }
    return {
      setSize: window.__studioSelectedMeshes().length,
      cubeDx: cube.position.x - startCubeX,
      sphereDx: sphere.position.x - startSphX,
      icoDx: ico.position.x - startIcoX,
    };
  });
  // eslint-disable-next-line no-console
  console.log('  multiselect probe:', JSON.stringify(result));
  expect(result.setSize, 'multi-select set has 2 meshes').toBe(2);
  expect(result.cubeDx, 'cube moved +0.15 with G x3').toBeCloseTo(0.15, 2);
  expect(result.sphereDx, 'sphere moved +0.15 with G x3').toBeCloseTo(0.15, 2);
  expect(result.icoDx, 'icosahedron unchanged (not in set)').toBeCloseTo(0, 2);
  await win.screenshot({ path: path.join(OUT, '01-grouped-move.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 192: multi-select via Shift+click + grouped G transform working end-to-end');

  await app.close();
});
