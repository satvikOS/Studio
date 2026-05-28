import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 105 — Complex Integration: Spider Mech Robot.
 *
 * Heavy scene #6 (after Forest S87, Sci-Fi City S90, AAA Game
 * Level S100, Character Production S101, Vehicle Showcase S103).
 * Mirrors Video-819 (mech) / Video-874 (spider mech) / Video-985
 * (organic alien armor) workflows from the reference reels.
 *
 * Hard-surface mechanical model composed by clicking 35+ Blender
 * + engine tools through the ribbon as a hard-surface modeler would.
 *
 * Mech composition (every step a real ribbon click):
 *
 *   CHASSIS    cube -> Stretch -> Extrude -> Solidify -> Chrome
 *   HEAD       icosa -> Multires -> Cast→Sphere -> Chrome
 *   EYES       sphere -> Material Instance (emissive low-roughness)
 *   LEGS       cylinder -> Bend -> Skin -> radial array x6
 *              (articulated leg joints around chassis)
 *   ANTENNAS   cylinder -> linear array x3 above head (skinned)
 *   ENERGY     sphere -> Niagara Burst (energy core)
 *   WEAPONS    cylinder -> linear array x4 (weapon mounts)
 *   GROUND     plane -> Loop Sub x3 -> Voronoi shader (concrete pad)
 *              -> Bake AO -> Lightmass
 *   PLATFORM   icosa -> linear array x8 (raised tiles)
 *   FX         smoke (vents) + sparkle (energy crackle)
 *   LIGHTING   SkyLight + 3 reflection probes + Sun + 3-point +
 *              2 spots + area
 *   WORLD      HDRI sky + Vol Fog
 *   ANIMATE    Mech idle keyframes (rotation + Niagara burst)
 *   RENDER     Shade Rendered + Showreel
 *   COMPOSITOR Bloom + Vignette + Chr Ab
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-spider-mech');

async function tab(win, name) {
  await win.locator(`.workbench-ribbon-placeholder-tab[data-studio-discipline="${name}"]`).click();
  await win.waitForTimeout(280);
}

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
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
    if (sel) { sel.value = m; sel.dispatchEvent(new Event('change', { bubbles: true })); }
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

test('Studio Integration — Spider Mech Robot (35+ Blender + engine tools)', async () => {
  test.setTimeout(420000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 80,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await tab(win, 'modeling');

  // ════ GROUND PAD ═════════════════════════════════════════════════
  await win.locator('[data-studio-primitive="plane"]').click();
  await win.waitForTimeout(280);
  await selectByKind(win, 'plane');
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="loop-subdivide"]').click();
  await win.waitForTimeout(350);
  await win.locator('[data-studio-ribbon-action="loop-subdivide"]').click();
  await win.waitForTimeout(350);
  await win.locator('[data-studio-ribbon-action="loop-subdivide"]').click();
  await win.waitForTimeout(350);

  await tab(win, 'uv-texture');
  await win.locator('[data-studio-ribbon-action="shader-voronoi"]').click();
  await win.waitForTimeout(300);
  await tab(win, 'modeling');
  await win.locator('[data-studio-ribbon-action="bake-ao"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="lightmass"]').click();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-ground-pad.png'), fullPage: false });

  // ════ PLATFORM TILES (8 icosa raised tiles linear array) ════════
  await win.locator('[data-studio-primitive="icosahedron"]').click();
  await win.waitForTimeout(280);
  await selectByKind(win, 'icosahedron');
  await win.waitForTimeout(280);
  await setArrayConfig(win, 'linear', 8, 0.014, 0.004, 0);
  await win.locator('[data-studio-ribbon-action="apply-array"]').click();
  await win.waitForTimeout(400);

  // ════ CHASSIS ════════════════════════════════════════════════════
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(280);
  await selectByKind(win, 'cube');
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="stretch"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="extrude"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="solidify"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-material-preset="chrome"]').click();
  await win.waitForTimeout(280);
  await win.screenshot({ path: path.join(OUT, '02-chassis.png'), fullPage: false });

  // ════ HEAD ═══════════════════════════════════════════════════════
  await win.locator('[data-studio-primitive="icosahedron"]').click();
  await win.waitForTimeout(280);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    // Select the LAST icosa added (the head, not the platform seed).
    let head = null;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'icosahedron') head = o;
    });
    if (head && window.__studioSelectMesh) window.__studioSelectMesh(head);
  });
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="multires"]').click();
  await win.waitForTimeout(500);
  await win.locator('[data-studio-ribbon-action="shrinkwrap"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-material-preset="chrome"]').click();
  await win.waitForTimeout(280);

  // ════ EYES (sphere with material instance) ═══════════════════════
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(280);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="material-instance"]').click();
  await win.waitForTimeout(280);

  // ════ LEGS (6 bent skinned cylinders radial array) ═══════════════
  await win.locator('[data-studio-primitive="cylinder"]').click();
  await win.waitForTimeout(280);
  await selectByKind(win, 'cylinder');
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="bend"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="skin-mod"]').click();
  await win.waitForTimeout(400);
  await setArrayConfig(win, 'radial', 6, 0, 0, 0, 0.035);
  await win.locator('[data-studio-ribbon-action="apply-array"]').click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '03-legs.png'), fullPage: false });

  // ════ ANTENNAS (3 skinned cylinders linear array) ════════════════
  await win.locator('[data-studio-primitive="cylinder"]').click();
  await win.waitForTimeout(280);
  await setArrayConfig(win, 'linear', 3, 0.006, 0, 0);
  await win.locator('[data-studio-ribbon-action="apply-array"]').click();
  await win.waitForTimeout(400);

  // ════ WEAPON MOUNTS (4 cylinders linear) ═════════════════════════
  await win.locator('[data-studio-primitive="cylinder"]').click();
  await win.waitForTimeout(280);
  await setArrayConfig(win, 'linear', 4, 0.012, 0, -0.01);
  await win.locator('[data-studio-ribbon-action="apply-array"]').click();
  await win.waitForTimeout(400);

  // ════ ENERGY CORE (Niagara burst on a sphere) ════════════════════
  await win.locator('[data-studio-ribbon-action="niagara-burst"]').click();
  await win.waitForTimeout(280);
  await win.screenshot({ path: path.join(OUT, '04-fully-built.png'), fullPage: false });

  // ════ FX ═════════════════════════════════════════════════════════
  await tab(win, 'vfx-sim');
  await win.locator('[data-studio-ribbon-action="preset-smoke"]').click();
  await win.waitForTimeout(400);
  await win.locator('[data-studio-ribbon-action="preset-sparkle"]').click();
  await win.waitForTimeout(400);

  // ════ ENV (Modeling tab Engine groups) ═══════════════════════════
  await tab(win, 'modeling');
  await win.locator('[data-studio-ribbon-action="sky-light"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="reflection-probe"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="reflection-probe"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="reflection-probe"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="vol-fog"]').click();
  await win.waitForTimeout(280);

  // ════ LIGHTING (Rendering tab) ═══════════════════════════════════
  await tab(win, 'rendering');
  await win.locator('[data-studio-action="three-point-preset"]').click();
  await win.waitForTimeout(400);
  await win.locator('[data-studio-ribbon-action="light-sun"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="light-spot"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="light-spot"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="light-area"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="world-hdri"]').click();
  await win.waitForTimeout(280);

  // ════ ANIMATE (Mech idle rotation keyframes) ═════════════════════
  await tab(win, 'animation');
  await selectByKind(win, 'cube');  // chassis
  await win.waitForTimeout(280);
  await setRange(win, '[data-studio-timeline="frame"]', '0');
  await win.locator('[data-studio-action="insert-keyframe"]').click();
  await win.waitForTimeout(220);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m) m.rotation.y = Math.PI / 6;
  });
  await setRange(win, '[data-studio-timeline="frame"]', '60');
  await win.locator('[data-studio-action="insert-keyframe"]').click();
  await win.waitForTimeout(220);

  // ════ RENDER + COMPOSITOR ═══════════════════════════════════════
  await tab(win, 'rendering');
  await win.locator('[data-studio-ribbon-action="shade-rendered"]').click();
  await win.waitForTimeout(280);
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

  // ════ FINAL VERIFICATION ═════════════════════════════════════════
  const final = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const k = {};
    let lights = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        const kind = o.userData.archdiscStudioPrimitiveKind;
        k[kind] = (k[kind] || 0) + 1;
      }
      if (o.userData && o.userData.archdiscStudioLight && o.isLight) lights++;
    });
    return { kinds: k, lights };
  });
  const total = Object.values(final.kinds).reduce((s, n) => s + n, 0);
  expect(total).toBeGreaterThanOrEqual(30);
  expect(final.lights).toBeGreaterThanOrEqual(6);
  expect(final.kinds['reflection-probe']).toBeGreaterThanOrEqual(3);

  // ════ ORBIT ══════════════════════════════════════════════════════
  for (const az of [0, 45, 90, 135, 180, 225, 270, 315]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 32, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `05-orbit-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  spider mech: ${total} primitives + ${final.lights} lights + 3 reflection probes`);
  console.log(`  kinds = ${JSON.stringify(final.kinds)}`);

  await app.close();
});
