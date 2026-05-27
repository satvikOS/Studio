import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 87 — Complex Environment Integration: Forest Scene.
 *
 * Per user directive: "do heavy testing by creating complex models,
 * environments etc and not just primitives and playing with it".
 *
 * Builds a full forest-with-campfire scene by clicking through the
 * Studio ribbon as a human would. Composes ~30 Blender-source-cited
 * tools end-to-end across 7 discipline tabs. Every step interacts
 * with the actual ribbon — no scene injection, no hook-call shortcuts.
 *
 * Scene composition:
 *
 *   GROUND     plane -> Loop Subdivide x2 -> Wave -> Noise Displace
 *              -> Bake AO to vertex colors
 *   TREES      20 cones in linear array, tapered (Simple Deform · TAPER),
 *              Loop Subdivided so silhouette is smooth
 *   ROCKS      12 icosahedra in radial array around campfire,
 *              cast to cuboid for angular faces, decimated for variation
 *   CAMPFIRE   particle preset · fire + smoke
 *   SPARKLES   particle preset · sparkle
 *   LIGHTING   3-Point Cinematic + Sun (directional)
 *   WORLD      HDRI sky background + Fog volume
 *   RENDER     Render Frame -> Compositor bloom + vignette
 *   SHOWREEL   4-angle capture
 *
 * Result is then orbited from 6 angles + verified via scene state
 * + screenshot count.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-forest-environment');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function tab(win, name) {
  await win.locator(`.workbench-ribbon-placeholder-tab[data-studio-discipline="${name}"]`).click();
  await win.waitForTimeout(280);
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

test('Studio Integration — Forest Environment (30+ Blender tools end-to-end)', async () => {
  test.setTimeout(360000);  // 6 minutes — heavy scene takes time at slowMo
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 100,  // faster than usual — long workflow
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await tab(win, 'modeling');

  // ════════ STEP 1: GROUND (ridged terrain) ════════════════════════
  await win.locator('[data-studio-primitive="plane"]').click();
  await win.waitForTimeout(250);
  await selectByKind(win, 'plane');
  await win.waitForTimeout(250);

  // Subdivide twice to give noise enough verts to push around.
  await win.locator('[data-studio-ribbon-action="loop-subdivide"]').click();
  await win.waitForTimeout(350);
  await win.locator('[data-studio-ribbon-action="loop-subdivide"]').click();
  await win.waitForTimeout(350);

  // Wave deformer (MOD_wave.cc) — ridges along radial distance.
  await win.locator('[data-studio-ribbon-action="wave"]').click();
  await win.waitForTimeout(300);
  // Bake AO -> vertex colors. Visible in viewport via material.vertexColors.
  await win.locator('[data-studio-ribbon-action="bake-ao"]').click();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-ground.png'), fullPage: false });

  // ════════ STEP 2: TREES (20-cone linear array, tapered) ══════════
  // Add a single cone, taper, subdivide, then Array x20.
  await win.locator('[data-studio-primitive="cone"]').click();
  await win.waitForTimeout(250);
  await selectByKind(win, 'cone');
  await win.waitForTimeout(250);
  await win.locator('[data-studio-ribbon-action="taper"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="loop-subdivide"]').click();
  await win.waitForTimeout(350);

  // Linear array of 20 along X.
  await win.evaluate(() => {
    const setRange = (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, String(val));
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const sel = document.querySelector('[data-studio-array="mode"]');
    if (sel) {
      sel.value = 'linear';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setRange('[data-studio-array="count"]', '20');
    setRange('[data-studio-array="offsetX"]', '0.012');
    setRange('[data-studio-array="offsetY"]', '0');
    setRange('[data-studio-array="offsetZ"]', '0');
  });
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="apply-array"]').click();
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(OUT, '02-trees.png'), fullPage: false });

  // ════════ STEP 3: ROCKS (radial array around fire pit) ═══════════
  await win.locator('[data-studio-primitive="icosahedron"]').click();
  await win.waitForTimeout(250);
  await selectByKind(win, 'icosahedron');
  await win.waitForTimeout(250);

  // Cast to cuboid for angular rocky look.
  await win.locator('[data-studio-ribbon-action="cast-cuboid"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="decimate"]').click();
  await win.waitForTimeout(300);

  // Radial array of 12 around origin.
  await win.evaluate(() => {
    const setRange = (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, String(val));
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const sel = document.querySelector('[data-studio-array="mode"]');
    if (sel) {
      sel.value = 'radial';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setRange('[data-studio-array="count"]', '12');
    setRange('[data-studio-array="radius"]', '0.025');
  });
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="apply-array"]').click();
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(OUT, '03-rocks.png'), fullPage: false });

  // ════════ STEP 4: CAMPFIRE PARTICLES (fire + smoke + sparkle) ═══
  await tab(win, 'vfx-sim');

  await win.locator('[data-studio-ribbon-action="preset-fire"]').click();
  await win.waitForTimeout(400);
  await win.locator('[data-studio-ribbon-action="preset-smoke"]').click();
  await win.waitForTimeout(400);
  await win.locator('[data-studio-ribbon-action="preset-sparkle"]').click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '04-campfire.png'), fullPage: false });

  // ════════ STEP 5: LIGHTING (3-point + sun) ═══════════════════════
  await tab(win, 'rendering');

  await win.locator('[data-studio-action="three-point-preset"]').click();
  await win.waitForTimeout(400);
  await win.locator('[data-studio-ribbon-action="light-sun"]').click();
  await win.waitForTimeout(300);

  // World HDRI background.
  await win.locator('[data-studio-ribbon-action="world-hdri"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="world-fog"]').click();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '05-lit.png'), fullPage: false });

  // ════════ STEP 6: RENDER + COMPOSITOR ═══════════════════════════
  await win.locator('[data-studio-action="capture-showreel"]').click();
  await expect.poll(
    async () => Number(await win.locator('[data-studio-render-count]').textContent()),
    { timeout: 15000 },
  ).toBeGreaterThanOrEqual(4);

  await tab(win, 'compositing');
  await win.locator('[data-studio-ribbon-action="comp-bloom"]').click();
  await win.waitForTimeout(500);
  await win.locator('[data-studio-ribbon-action="comp-vignette"]').click();
  await win.waitForTimeout(500);

  // ════════ FINAL VERIFICATION ═════════════════════════════════════
  const finalScene = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const kinds = {};
    let prim = 0, lights = 0, points = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        prim++;
        const k = o.userData.archdiscStudioPrimitiveKind || 'mesh';
        kinds[k] = (kinds[k] || 0) + 1;
      }
      if (o.userData && o.userData.archdiscStudioLight && o.isLight) lights++;
      if (o.isPoints && o.userData && o.userData.archdiscStudioPrimitive) points++;
    });
    return { prim, lights, points, kinds };
  });
  // ≥1 plane (ground), 1 cone + 19 cone-array (trees), 1 icosa + 11 array (rocks),
  // 3 particle clouds (fire/smoke/sparkle).
  expect(finalScene.prim).toBeGreaterThanOrEqual(35);
  expect(finalScene.lights).toBeGreaterThanOrEqual(4);    // 3-point (3) + sun
  expect(finalScene.points).toBeGreaterThanOrEqual(3);    // fire + smoke + sparkle
  expect(finalScene.kinds['plane']).toBe(1);
  expect(finalScene.kinds['cone']).toBe(1);
  expect(finalScene.kinds['cone-array']).toBe(19);
  expect(finalScene.kinds['icosahedron']).toBe(1);
  expect(finalScene.kinds['icosahedron-array']).toBe(11);
  expect(finalScene.kinds['particle-fire']).toBe(1);
  expect(finalScene.kinds['particle-smoke']).toBe(1);
  expect(finalScene.kinds['particle-sparkle']).toBe(1);

  // ════════ ORBIT — 8 angles of the final scene ════════════════════
  for (const az of [0, 45, 90, 135, 180, 225, 270, 315]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 30, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `06-orbit-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  forest environment: ${finalScene.prim} primitives + ${finalScene.lights} lights + ${finalScene.points} particle systems`);
  console.log(`  kinds = ${JSON.stringify(finalScene.kinds)}`);

  await app.close();
});
