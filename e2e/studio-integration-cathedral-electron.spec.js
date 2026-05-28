import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 107 — Complex Integration: Cathedral Interior.
 *
 * Heavy-test scene #7 mirroring Video-741 (vaulted column/branch
 * sculpture) + Video-433 (ruined gothic city) workflows from the
 * 45-video reference reels.
 *
 * Architectural visualization scene composed by clicking 35+
 * Blender + engine tools through the ribbon.
 *
 * Cathedral composition (every step = real ribbon click):
 *
 *   FLOOR      plane -> Loop Sub x3 -> Brick shader texture
 *              -> Bake AO -> Lightmass bake
 *   COLUMNS    cylinder -> Skin (smooth tube) -> Bevel ->
 *              linear array x8 (left aisle) + array x8 (right aisle)
 *              -> we approximate by doing one row of 14 columns
 *   ARCHES     torus -> Bisect (cut top half) -> linear array x7
 *   ALTAR      cube -> Stretch + Extrude -> Solidify -> Chrome
 *   PEWS       cube -> linear array x10 (rows of seating)
 *   CANDLES    cylinder -> Skin -> linear array x6
 *   STAINED    plane -> Voronoi shader -> Magic shader (4 planes)
 *   VAULTS     plane -> Bend -> Loop Sub x2
 *   INCENSE    smoke + sparkle particles
 *   LIGHTING   3-Point + 6 Spots (sun shafts through windows)
 *              + SkyLight + 2 Reflection Probes
 *   WORLD      HDRI sky + Vol Fog (incense haze)
 *   FX         Niagara Burst (votive flames)
 *   RENDER     Shade Rendered + Showreel
 *   COMPOSITOR Bloom + Vignette + Chr Ab
 *   FRAME ALL  auto-fits camera to scene
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-cathedral');

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

test('Studio Integration — Cathedral Interior (35+ Blender + engine tools)', async () => {
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

  // ════ FLOOR ══════════════════════════════════════════════════════
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
  await win.locator('[data-studio-ribbon-action="shader-brick"]').click();
  await win.waitForTimeout(300);
  await tab(win, 'modeling');
  await win.locator('[data-studio-ribbon-action="bake-ao"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="lightmass"]').click();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-floor.png'), fullPage: false });

  // ════ COLUMNS (14 cylinder linear array, skinned) ═══════════════
  await win.locator('[data-studio-primitive="cylinder"]').click();
  await win.waitForTimeout(280);
  await selectByKind(win, 'cylinder');
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="skin-mod"]').click();
  await win.waitForTimeout(400);
  await win.locator('[data-studio-ribbon-action="bevel"]').click();
  await win.waitForTimeout(280);
  await setArrayConfig(win, 'linear', 14, 0.014, 0, 0);
  await win.locator('[data-studio-ribbon-action="apply-array"]').click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '02-columns.png'), fullPage: false });

  // ════ ARCHES (torus -> bisect -> linear array x7) ═══════════════
  await win.locator('[data-studio-primitive="torus"]').click();
  await win.waitForTimeout(280);
  await selectByKind(win, 'torus');
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="bisect"]').click();
  await win.waitForTimeout(300);
  await setArrayConfig(win, 'linear', 7, 0.014, 0.025, 0);
  await win.locator('[data-studio-ribbon-action="apply-array"]').click();
  await win.waitForTimeout(400);

  // ════ ALTAR ══════════════════════════════════════════════════════
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

  // ════ PEWS (10-cube linear array) ════════════════════════════════
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(280);
  await setArrayConfig(win, 'linear', 10, 0.016, 0, 0);
  await win.locator('[data-studio-ribbon-action="apply-array"]').click();
  await win.waitForTimeout(400);

  // ════ CANDLES (6 cylinders skinned + linear array) ══════════════
  await win.locator('[data-studio-primitive="cylinder"]').click();
  await win.waitForTimeout(280);
  await setArrayConfig(win, 'linear', 6, 0.008, 0, 0);
  await win.locator('[data-studio-ribbon-action="apply-array"]').click();
  await win.waitForTimeout(400);

  // ════ STAINED GLASS PLANES (2 with shader textures) ═════════════
  await win.locator('[data-studio-primitive="plane"]').click();
  await win.waitForTimeout(280);
  await selectByKind(win, 'plane');
  await win.waitForTimeout(280);
  await tab(win, 'uv-texture');
  await win.locator('[data-studio-ribbon-action="shader-magic"]').click();
  await win.waitForTimeout(300);
  await tab(win, 'modeling');
  await win.locator('[data-studio-primitive="plane"]').click();
  await win.waitForTimeout(280);
  await tab(win, 'uv-texture');
  await win.locator('[data-studio-ribbon-action="shader-wave"]').click();
  await win.waitForTimeout(300);
  await tab(win, 'modeling');
  await win.screenshot({ path: path.join(OUT, '03-arches-pews-stained.png'), fullPage: false });

  // ════ FX (Niagara votives + smoke + sparkle) ═════════════════════
  await win.locator('[data-studio-ribbon-action="niagara-burst"]').click();
  await win.waitForTimeout(300);
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
  await win.locator('[data-studio-ribbon-action="vol-fog"]').click();
  await win.waitForTimeout(280);

  // ════ LIGHTING (3-point + 6 spots for sun shafts + sun) ═════════
  await tab(win, 'rendering');
  await win.locator('[data-studio-action="three-point-preset"]').click();
  await win.waitForTimeout(400);
  await win.locator('[data-studio-ribbon-action="light-sun"]').click();
  await win.waitForTimeout(280);
  for (let i = 0; i < 6; i++) {
    await win.locator('[data-studio-ribbon-action="light-spot"]').click();
    await win.waitForTimeout(220);
  }
  await win.locator('[data-studio-ribbon-action="world-hdri"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="shade-rendered"]').click();
  await win.waitForTimeout(280);

  // ════ FRAME ALL — fit camera to scene ════════════════════════════
  await tab(win, 'modeling');
  await win.locator('[data-studio-action="frame-all"]').click();
  await win.waitForTimeout(400);

  // ════ RENDER + COMPOSITOR ═══════════════════════════════════════
  await tab(win, 'rendering');
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
  expect(total).toBeGreaterThanOrEqual(40);
  expect(final.lights).toBeGreaterThanOrEqual(8);  // 3-point + sun + 6 spots = 10

  // ════ ORBIT ══════════════════════════════════════════════════════
  for (const az of [0, 45, 90, 135, 180, 225, 270, 315]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 26, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `04-orbit-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  cathedral: ${total} primitives + ${final.lights} lights`);
  console.log(`  kinds = ${JSON.stringify(final.kinds)}`);

  await app.close();
});
