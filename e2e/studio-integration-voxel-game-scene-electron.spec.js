import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 28 — Integration project: "Voxel Game Scene".
 *
 * Second complex-project integration test, this one biased toward the
 * gaming / AAA-asset discipline. No Math.random anywhere; the runtime
 * being exercised is fully deterministic.
 *
 * Workflow:
 *   1. Voxel terrain — add a Voxel Cube as the ground.
 *   2. Voxel canopy — add a Voxel Sphere above the terrain (mirrored
 *      across Y to give it a top-and-bottom dome).
 *   3. Forest — three procedural trees at depth 3 / branches 3.
 *   4. Character — a Bone Chain armature (10 bones) for the figure.
 *   5. Clone the cube into a 200-instance swarm via the Instancing
 *      tool (a Minecraft-style cube field) — proves InstancedMesh
 *      lands as one Studio primitive with one draw call.
 *   6. Lighting — 2 cinematic point lights (warm tungsten + cool sky).
 *   7. Physics — Drop with Gravity for ~1 s, then Pause.
 *   8. Animation — spin the armature character.
 *   9. Showreel — 4-view turntable capture of the whole scene.
 *  10. Compositing — high-contrast post-process on the last render.
 *
 * Integrated final state:
 *   - 7 Studio primitives (terrain, canopy, 3 trees, armature, swarm)
 *   - 2 lights
 *   - Animation 'playing', physics paused
 *   - Render count = 5 (4 showreel + 1 contrast post)
 *   - All primitives at-or-below the original Y after physics pulse.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-voxel-game-scene');

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

test('Studio integration — build a Voxel Game Scene across the gaming pipeline', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 200,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(OUT, '00-empty-canvas.png'), fullPage: false });

  // === Step 1 — Voxel terrain ===
  await win.locator('[data-studio-primitive="voxel-cube"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('1 primitive in scene');

  // === Step 2 — Voxel canopy, mirrored across Y for top/bottom dome ===
  await win.locator('[data-studio-primitive="voxel-sphere"]').click();
  await win.waitForTimeout(300);
  const canopyPos = await screenPosOfMesh(win, 'voxel-sphere', 0);
  expect(canopyPos).not.toBeNull();
  await win.mouse.click(canopyPos.x, canopyPos.y);
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('voxel-sphere');
  await win.locator('[data-studio-mirror="axis"]').selectOption('y');
  await win.locator('[data-studio-action="mirror-selected"]').click();
  await win.waitForTimeout(400);

  // === Step 3 — Procedural forest (three trees, identical params → identical trees) ===
  await setRange(win, '[data-studio-proc="depth"]',    '3');
  await setRange(win, '[data-studio-proc="branches"]', '3');
  for (let i = 0; i < 3; i++) {
    await win.locator('[data-studio-action="generate-tree"]').click();
    await win.waitForTimeout(400);
  }
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('5 primitives in scene');
  await win.screenshot({ path: path.join(OUT, '01-terrain-canopy-forest.png'), fullPage: false });

  // === Step 4 — Armature character (10-bone chain), animated immediately
  //              (do this BEFORE the swarm spawn so the armature isn't
  //              raycast-occluded by overlapping swarm instances). ===
  await setRange(win, '[data-studio-armature="bones"]', '10');
  await win.locator('[data-studio-action="add-armature"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('6 primitives in scene');

  const armPosEarly = await screenPosOfMesh(win, 'armature', 0);
  expect(armPosEarly).not.toBeNull();
  await win.mouse.click(armPosEarly.x, armPosEarly.y);
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('armature');
  await setRange(win, '[data-studio-animation="speed"]', '180');
  await win.locator('[data-studio-action="toggle-animation"]').click();
  await expect(win.locator('[data-studio-animation-state]')).toHaveText('playing');
  await win.waitForTimeout(300);

  // === Step 5 — Instance the voxel terrain into a 200-cube field ===
  const terrainPos = await screenPosOfMesh(win, 'voxel-cube', 0);
  await win.mouse.click(terrainPos.x, terrainPos.y);
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('voxel-cube');
  await setRange(win, '[data-studio-instancing="count"]',  '200');
  await setRange(win, '[data-studio-instancing="radius"]', '0.12');
  await win.locator('[data-studio-action="spawn-swarm"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('7 primitives in scene');

  // Confirm the swarm landed as an InstancedMesh with the right count.
  const swarmInfo = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let im = null;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'instanced-swarm') im = o;
    });
    return im ? { count: im.count, isInst: !!im.isInstancedMesh } : null;
  });
  expect(swarmInfo).not.toBeNull();
  expect(swarmInfo.isInst).toBe(true);
  expect(swarmInfo.count).toBe(200);

  // === Step 6 — Two cinematic lights ===
  await win.locator('[data-studio-lighting="color"]').fill('#ffb56b');
  await setRange(win, '[data-studio-lighting="intensity"]', '2.2');
  await win.locator('[data-studio-action="add-light"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-lighting="color"]').fill('#6bb5ff');
  await setRange(win, '[data-studio-lighting="intensity"]', '1.4');
  await win.locator('[data-studio-action="add-light"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-light-count]')).toHaveText('2 added');

  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(35, 22, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '02-scene-pre-physics.png'), fullPage: false });

  // === Step 7 — Physics pulse ===
  const ysBeforePhysics = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const ys = [];
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) ys.push(o.position.y);
    });
    return ys;
  });
  await win.locator('[data-studio-action="toggle-physics"]').click();
  await expect(win.locator('[data-studio-physics-state]')).toHaveText('simulating');
  await win.waitForTimeout(1000);
  await win.locator('[data-studio-action="toggle-physics"]').click();
  await expect(win.locator('[data-studio-physics-state]')).toHaveText('idle');
  const ysAfterPhysics = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const ys = [];
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) ys.push(o.position.y);
    });
    return ys;
  });
  // Every primitive moved DOWN (or stayed at ground) after the pulse.
  for (let i = 0; i < ysBeforePhysics.length; i++) {
    expect(ysAfterPhysics[i]).toBeLessThanOrEqual(ysBeforePhysics[i] + 0.0001);
  }
  await win.screenshot({ path: path.join(OUT, '03-after-physics.png'), fullPage: false });

  // === Step 8 — Animation is already running (started in step 4 before
  //              the swarm spawn). Just confirm it's still alive. ===
  await expect(win.locator('[data-studio-animation-state]')).toHaveText('playing');

  // === Step 9 — Showreel ===
  await win.locator('[data-studio-action="capture-showreel"]').click();
  await expect
    .poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()),
          { timeout: 12000 })
    .toBe(4);

  // === Step 10 — High-contrast post-process ===
  await win.locator('[data-studio-compositing="filter"]').selectOption('contrast(180%)');
  await win.locator('[data-studio-action="post-process"]').click();
  await expect
    .poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()),
          { timeout: 6000 })
    .toBe(5);

  // === Final integrated assertions ===
  const finalState = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const kinds = new Set();
    let prim = 0, lights = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        prim++;
        kinds.add(o.userData.archdiscStudioPrimitiveKind);
      }
      if (o.userData && o.userData.archdiscStudioLight) lights++;
    });
    return { prim, lights, kinds: Array.from(kinds).sort() };
  });
  expect(finalState.prim).toBe(7);
  expect(finalState.lights).toBe(2);
  const expectedKinds = [
    'armature', 'instanced-swarm', 'procedural-tree',
    'voxel-cube', 'voxel-sphere',
  ];
  expect(finalState.kinds).toEqual(expectedKinds);
  await expect(win.locator('[data-studio-animation-state]')).toHaveText('playing');
  await expect(win.locator('[data-studio-render-count]')).toHaveText('5');

  // ---- Headline turntable views ----
  for (const a of [45, 135, 225, 315]) {
    await win.evaluate((az) => window.__archdiscOrbitView && window.__archdiscOrbitView(az, 22, 1), a);
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `04-final-game-scene-az${a}.png`), fullPage: false });
  }

  // Stop the spin so app.close() doesn't race with a live rAF loop.
  await win.locator('[data-studio-action="toggle-animation"]').click();

  // eslint-disable-next-line no-console
  console.log(`  voxel game: ${finalState.prim} primitives + ${finalState.lights} lights + 5 renders. swarm=${swarmInfo.count} instances. physics + animation pipeline integrated.`);

  await app.close();
});
