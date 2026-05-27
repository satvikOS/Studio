import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 27 — Integration project: "Crystal Garden".
 *
 * Per the no-randomness / complex-project rule: this spec performs a
 * recognizable multi-discipline workflow start-to-finish and verifies
 * the integrated scene. Every action goes through real user
 * interactions (ribbon clicks, panel sliders, raycast picks); no
 * scene injection, no Math.random in the runtime code being tested.
 *
 * Workflow:
 *   1. Extrude a Rectangle floor plan (ArchViz).
 *   2. Add 5 different "crystal" primitives — cube, sphere, voxel
 *      cube, torus knot, dodecahedron — laid out by the grid.
 *   3. Pick the sphere, subdivide it once, then sculpt Inflate so it
 *      becomes a knobbly gem.
 *   4. Pick the cube, paint a Brick texture onto it.
 *   5. Pick the torus knot, change its color to a vivid cyan.
 *   6. Pick the voxel cube, apply Mirror modifier across X.
 *   7. Add a procedural tree as a backdrop element.
 *   8. Add a 3D Text label "Crystal Garden" at 12 mm size.
 *   9. Add three cinematic lights — warm key, cool fill, magenta rim.
 *  10. Capture a 4-view showreel.
 *  11. Post-process the last render through a Sepia + Contrast pass.
 *
 * Final assertions:
 *   - Exactly 8 Studio primitives in scene (1 floor + 5 crystals +
 *     1 tree + 1 text mesh).
 *   - 3 cinematic lights.
 *   - 5 renders (4 showreel + 1 sepia post-process).
 *   - Specific kinds present in the scene by archdiscStudioPrimitiveKind.
 *   - The textured cube has material.map; the recolored torus has
 *     the asserted color; the subdivided sphere face count > 4× baseline.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-crystal-garden');

async function screenPosOfMesh(win, kind, occurrence) {
  return await win.evaluate(({ k, n }) => {
    const vp = window.__archdiscViewport;
    let hits = 0;
    let target = null;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) {
        if (hits === n) target = o;
        hits++;
      }
    });
    if (!target) return null;
    const v = target.position.clone().project(vp.camera);
    const rect = vp.renderer.domElement.getBoundingClientRect();
    return {
      x: (v.x + 1) / 2 * rect.width + rect.left,
      y: (-v.y + 1) / 2 * rect.height + rect.top,
    };
  }, { k: kind, n: occurrence || 0 });
}

async function setRange(win, selector, value) {
  await win.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel: selector, val: value });
}

test('Studio integration — build a Crystal Garden across 8 disciplines', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 250,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(OUT, '00-empty-canvas.png'), fullPage: false });

  // === Step 1 — ArchViz floor plan (rectangle, 20 mm wall) ===
  await win.locator('[data-studio-archviz="shape"]').selectOption('rectangle');
  await setRange(win, '[data-studio-archviz="height"]', '0.020');
  await win.locator('[data-studio-action="extrude-floorplan"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('1 primitive in scene');

  // === Step 2 — the five "crystals" ===
  for (const k of ['cube', 'sphere', 'voxel-cube', 'torus-knot', 'dodecahedron']) {
    await win.locator(`[data-studio-primitive="${k}"]`).click();
    await win.waitForTimeout(220);
  }
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('6 primitives in scene');
  await win.screenshot({ path: path.join(OUT, '01-floor-and-five-crystals.png'), fullPage: false });

  // === Step 3 — Sphere subdivided + inflated into a knobbly gem ===
  const spherePos = await screenPosOfMesh(win, 'sphere', 0);
  expect(spherePos).not.toBeNull();
  await win.mouse.click(spherePos.x, spherePos.y);
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('sphere');
  const sphereBaselineF = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o;
    });
    if (!m) return 0;
    return m.geometry.index
      ? m.geometry.index.count / 3
      : m.geometry.attributes.position.count / 3;
  });
  await win.locator('[data-studio-action="subdivide-selected"]').click();
  await win.waitForTimeout(400);
  await setRange(win, '[data-studio-sculpt="strength"]', '0.18');
  await win.locator('[data-studio-action="sculpt-inflate"]').click();
  await win.waitForTimeout(400);
  const sphereAfterF = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o;
    });
    if (!m) return 0;
    return m.geometry.index
      ? m.geometry.index.count / 3
      : m.geometry.attributes.position.count / 3;
  });
  expect(sphereAfterF).toBe(sphereBaselineF * 4);

  // === Step 4 — Cube takes a Brick texture (8 tiles) ===
  const cubePos = await screenPosOfMesh(win, 'cube', 0);
  await win.mouse.click(cubePos.x, cubePos.y);
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('cube');
  await win.locator('[data-studio-texture="pattern"]').selectOption('brick');
  await setRange(win, '[data-studio-texture="tiles"]', '8');
  await win.locator('[data-studio-action="apply-texture"]').click();
  await win.waitForTimeout(400);

  // === Step 5 — Torus knot recolored to cyan ===
  const tknotPos = await screenPosOfMesh(win, 'torus-knot', 0);
  await win.mouse.click(tknotPos.x, tknotPos.y);
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('torus-knot');
  await win.locator('[data-studio-material="color"]').fill('#28d4d4');
  await win.waitForTimeout(300);

  // === Step 6 — Voxel cube mirrored across X ===
  const voxPos = await screenPosOfMesh(win, 'voxel-cube', 0);
  await win.mouse.click(voxPos.x, voxPos.y);
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('voxel-cube');
  await win.locator('[data-studio-mirror="axis"]').selectOption('x');
  await win.locator('[data-studio-action="mirror-selected"]').click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '02-after-shaping-each-crystal.png'), fullPage: false });

  // === Step 7 — Procedural tree as backdrop ===
  await setRange(win, '[data-studio-proc="depth"]',    '3');
  await setRange(win, '[data-studio-proc="branches"]', '3');
  await win.locator('[data-studio-action="generate-tree"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('7 primitives in scene');

  // === Step 8 — Floating "Crystal Garden" 3D text ===
  await expect(win.locator('[data-studio-font-state]')).toHaveText('font ready', { timeout: 15000 });
  await win.locator('[data-studio-text3d="input"]').fill('Crystal Garden');
  await setRange(win, '[data-studio-text3d="size"]', '0.012');
  await win.locator('[data-studio-action="add-text3d"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('8 primitives in scene');
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(35, 22, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '03-tree-and-text-added.png'), fullPage: false });

  // === Step 9 — Three cinematic lights: warm key / cool fill / magenta rim ===
  await win.locator('[data-studio-lighting="color"]').fill('#ffb56b');
  await setRange(win, '[data-studio-lighting="intensity"]', '2.4');
  await win.locator('[data-studio-action="add-light"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-lighting="color"]').fill('#6bb5ff');
  await setRange(win, '[data-studio-lighting="intensity"]', '1.6');
  await win.locator('[data-studio-action="add-light"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-lighting="color"]').fill('#d469c4');
  await setRange(win, '[data-studio-lighting="intensity"]', '1.2');
  await win.locator('[data-studio-action="add-light"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-light-count]')).toHaveText('3 added');

  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(45, 20, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '04-three-lights-on-scene.png'), fullPage: false });

  // === Step 10 — Four-view showreel ===
  await win.locator('[data-studio-action="capture-showreel"]').click();
  await expect
    .poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()),
          { timeout: 12000 })
    .toBe(4);

  // === Step 11 — Sepia + Contrast post-process passes ===
  await win.locator('[data-studio-compositing="filter"]').selectOption('sepia(100%)');
  await win.locator('[data-studio-action="post-process"]').click();
  await expect
    .poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()),
          { timeout: 6000 })
    .toBe(5);

  // === Final integrated assertions ===
  const integratedState = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const kinds = new Set();
    let prim = 0, lights = 0;
    let cubeMap = false, torusKnotColor = null;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        prim++;
        const k = o.userData.archdiscStudioPrimitiveKind;
        kinds.add(k);
        if (k === 'cube' && o.material && o.material.map) cubeMap = true;
        if (k === 'torus-knot' && o.material && o.material.color) {
          torusKnotColor = '#' + o.material.color.getHexString();
        }
      }
      if (o.userData && o.userData.archdiscStudioLight) lights++;
    });
    return { prim, lights, kinds: Array.from(kinds).sort(), cubeMap, torusKnotColor };
  });
  expect(integratedState.prim).toBe(8);
  expect(integratedState.lights).toBe(3);
  expect(integratedState.cubeMap).toBe(true);
  expect(integratedState.torusKnotColor).toBe('#28d4d4');
  // Every authored kind is present (sphere appears twice — once
  // standalone, once mirrored into the voxel — Set collapses
  // duplicates).
  const expectKinds = ['cube', 'dodecahedron', 'floor-plan-rectangle',
                       'procedural-tree', 'sphere', 'text-3d',
                       'torus-knot', 'voxel-cube'];
  expect(integratedState.kinds).toEqual(expectKinds);
  await expect(win.locator('[data-studio-render-count]')).toHaveText('5');

  // ---- Headline turntable views of the finished garden ----
  for (const a of [40, 130, 220, 310]) {
    await win.evaluate((az) => window.__archdiscOrbitView && window.__archdiscOrbitView(az, 20, 1), a);
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `05-final-garden-az${a}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  crystal garden: ${integratedState.prim} primitives + ${integratedState.lights} lights + 5 renders across 8 disciplines`);

  await app.close();
});
