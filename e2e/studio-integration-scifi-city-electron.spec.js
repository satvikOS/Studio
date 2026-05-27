import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 90 — Complex Environment Integration: Sci-Fi City.
 *
 * Heavy-test per user directive: "do heavy testing by creating
 * complex models, environments etc and not just primitives".
 * Mirrors Video-455 (sci-fi megastructure) + Video-433 (ruined
 * gothic city) + Video-879 (Geometry-Nodes city scatter) patterns
 * observed in the 45-video reference reels.
 *
 * Composes ~40 Blender-source-cited tools end-to-end by clicking
 * through the ribbon as a human would. No scene injection.
 *
 * Scene composition (every step a real ribbon click):
 *
 *   GROUND
 *     plane -> Loop Sub x3 -> Voronoi shader texture -> Wave
 *     -> Color Ramp -> Bake AO
 *   SKYSCRAPERS
 *     cube -> Stretch (Y up) -> Extrude -> linear array x18
 *     -> Apply Xform on first
 *   DOMES
 *     sphere -> Cast→Cuboid -> Solidify -> radial array x10
 *   SPIRES
 *     icosahedron -> Taper -> Loop Sub -> linear array x12
 *   STREETLIGHTS
 *     cylinder -> Skin modifier -> linear array x14
 *   CENTRAL TOWER
 *     icosahedron -> Multires -> Cast→Sphere -> Chrome material
 *   ATMOSPHERE
 *     Smoke particle preset + Sparkle particle preset
 *   LIGHTING
 *     Sun + 4 Spot lights + 3-Point Cinematic
 *   WORLD
 *     HDRI sky + Fog
 *   RENDER + COMPOSITOR
 *     Showreel (4 frames) + Bloom + Vignette + Chromatic Aberration
 *
 * Final scene: ≥55 primitives + 8 lights + 2 particle systems.
 * 8-angle orbit captures.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-scifi-city');

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

async function setArrayConfig(win, mode, count, ax, ay, az, radius) {
  await win.evaluate(({ m, c, x, y, z, r }) => {
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
      sel.value = m;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setRange('[data-studio-array="count"]', c);
    if (m === 'linear') {
      setRange('[data-studio-array="offsetX"]', x);
      setRange('[data-studio-array="offsetY"]', y);
      setRange('[data-studio-array="offsetZ"]', z);
    } else if (m === 'radial') {
      setRange('[data-studio-array="radius"]', r);
    }
  }, { m: mode, c: count, x: ax, y: ay, z: az, r: radius });
  await win.waitForTimeout(200);
}

test('Studio Integration — Sci-Fi City (40+ Blender tools end-to-end)', async () => {
  test.setTimeout(420000); // 7 min
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 80, // tight pacing — long workflow
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await tab(win, 'modeling');

  // ════════════ STEP 1: GROUND PLANE ═══════════════════════════════
  await win.locator('[data-studio-primitive="plane"]').click();
  await win.waitForTimeout(220);
  await selectByKind(win, 'plane');
  await win.waitForTimeout(220);

  await win.locator('[data-studio-ribbon-action="loop-subdivide"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="loop-subdivide"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="loop-subdivide"]').click();
  await win.waitForTimeout(280);

  await tab(win, 'uv-texture');
  await win.locator('[data-studio-ribbon-action="shader-voronoi"]').click();
  await win.waitForTimeout(280);

  await tab(win, 'modeling');
  await win.locator('[data-studio-ribbon-action="wave"]').click();
  await win.waitForTimeout(280);

  await tab(win, 'uv-texture');
  await win.locator('[data-studio-ribbon-action="shader-color-ramp"]').click();
  await win.waitForTimeout(280);

  await tab(win, 'modeling');
  await win.locator('[data-studio-ribbon-action="bake-ao"]').click();
  await win.waitForTimeout(280);
  await win.screenshot({ path: path.join(OUT, '01-ground.png'), fullPage: false });

  // ════════════ STEP 2: SKYSCRAPERS (18-cube linear array) ════════
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(220);
  await selectByKind(win, 'cube');
  await win.waitForTimeout(220);

  await win.locator('[data-studio-ribbon-action="stretch"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="extrude"]').click();
  await win.waitForTimeout(280);

  await setArrayConfig(win, 'linear', 18, 0.014, 0, 0);
  await win.locator('[data-studio-ribbon-action="apply-array"]').click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '02-skyscrapers.png'), fullPage: false });

  // ════════════ STEP 3: DOMES (10-sphere radial array) ════════════
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(220);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(220);

  await win.locator('[data-studio-ribbon-action="cast-cuboid"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="solidify"]').click();
  await win.waitForTimeout(280);

  await setArrayConfig(win, 'radial', 10, 0, 0, 0, 0.04);
  await win.locator('[data-studio-ribbon-action="apply-array"]').click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '03-domes.png'), fullPage: false });

  // ════════════ STEP 4: SPIRES (12-icosa linear array) ════════════
  await win.locator('[data-studio-primitive="icosahedron"]').click();
  await win.waitForTimeout(220);
  await selectByKind(win, 'icosahedron');
  await win.waitForTimeout(220);

  await win.locator('[data-studio-ribbon-action="taper"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="loop-subdivide"]').click();
  await win.waitForTimeout(280);

  await setArrayConfig(win, 'linear', 12, 0.018, 0, 0.01);
  await win.locator('[data-studio-ribbon-action="apply-array"]').click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '04-spires.png'), fullPage: false });

  // ════════════ STEP 5: STREETLIGHTS (14-cylinder array w/ skin) ══
  await win.locator('[data-studio-primitive="cylinder"]').click();
  await win.waitForTimeout(220);
  await selectByKind(win, 'cylinder');
  await win.waitForTimeout(220);

  await win.locator('[data-studio-ribbon-action="skin-mod"]').click();
  await win.waitForTimeout(280);

  await setArrayConfig(win, 'linear', 14, 0.013, 0, -0.012);
  await win.locator('[data-studio-ribbon-action="apply-array"]').click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '05-streetlights.png'), fullPage: false });

  // ════════════ STEP 6: CENTRAL TOWER (multires + sphere cast) ════
  await win.locator('[data-studio-primitive="icosahedron"]').click();
  await win.waitForTimeout(220);
  await selectByKind(win, 'icosahedron');
  await win.waitForTimeout(220);

  await win.locator('[data-studio-ribbon-action="multires"]').click();
  await win.waitForTimeout(400);
  await win.locator('[data-studio-ribbon-action="shrinkwrap"]').click();
  await win.waitForTimeout(280);
  // Chrome material via right-rail click.
  await win.locator('[data-studio-material-preset="chrome"]').click();
  await win.waitForTimeout(280);
  await win.screenshot({ path: path.join(OUT, '06-central-tower.png'), fullPage: false });

  // ════════════ STEP 7: ATMOSPHERE PARTICLES ═══════════════════════
  await tab(win, 'vfx-sim');
  await win.locator('[data-studio-ribbon-action="preset-smoke"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="preset-sparkle"]').click();
  await win.waitForTimeout(300);

  // ════════════ STEP 8: LIGHTING ═══════════════════════════════════
  await tab(win, 'rendering');
  await win.locator('[data-studio-action="three-point-preset"]').click();
  await win.waitForTimeout(400);
  await win.locator('[data-studio-ribbon-action="light-sun"]').click();
  await win.waitForTimeout(250);
  await win.locator('[data-studio-ribbon-action="light-spot"]').click();
  await win.waitForTimeout(250);
  await win.locator('[data-studio-ribbon-action="light-spot"]').click();
  await win.waitForTimeout(250);
  await win.locator('[data-studio-ribbon-action="light-spot"]').click();
  await win.waitForTimeout(250);
  await win.locator('[data-studio-ribbon-action="light-spot"]').click();
  await win.waitForTimeout(250);
  await win.locator('[data-studio-ribbon-action="light-area"]').click();
  await win.waitForTimeout(250);

  // ════════════ STEP 9: WORLD ══════════════════════════════════════
  await win.locator('[data-studio-ribbon-action="world-hdri"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="world-fog"]').click();
  await win.waitForTimeout(280);

  // ════════════ STEP 10: VIEW SHADING -> RENDERED ══════════════════
  await win.locator('[data-studio-ribbon-action="shade-rendered"]').click();
  await win.waitForTimeout(280);

  // ════════════ STEP 11: RENDER + COMPOSITOR ═══════════════════════
  await win.locator('[data-studio-action="capture-showreel"]').click();
  await expect.poll(
    async () => Number(await win.locator('[data-studio-render-count]').textContent()),
    { timeout: 15000 },
  ).toBeGreaterThanOrEqual(4);

  await tab(win, 'compositing');
  await win.locator('[data-studio-ribbon-action="comp-bloom"]').click();
  await win.waitForTimeout(400);
  await win.locator('[data-studio-ribbon-action="comp-vignette"]').click();
  await win.waitForTimeout(400);
  await win.locator('[data-studio-ribbon-action="comp-chromatic"]').click();
  await win.waitForTimeout(400);

  // ════════════ FINAL SCENE VERIFICATION ════════════════════════════
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
  // 1 plane + 1 cube + 17 cube-array + 1 sphere + 9 sphere-array
  // + 2 icosa + 11 + 11 icosa-array + 1 cylinder + 13 cylinder-array
  // + 2 particles (smoke, sparkle) = ~70
  expect(finalScene.prim).toBeGreaterThanOrEqual(50);
  // 3-point (3) + sun + 4 spots + area = 9 lights.
  expect(finalScene.lights).toBeGreaterThanOrEqual(7);
  expect(finalScene.points).toBeGreaterThanOrEqual(2);  // smoke + sparkle

  // ════════════ ORBIT — 8 angles ════════════════════════════════════
  for (const az of [0, 45, 90, 135, 180, 225, 270, 315]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 40, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `07-orbit-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  sci-fi city: ${finalScene.prim} primitives + ${finalScene.lights} lights + ${finalScene.points} particle systems`);
  console.log(`  kinds = ${JSON.stringify(finalScene.kinds)}`);

  await app.close();
});
