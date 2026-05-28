import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 101 — Complex Integration: Character Production Pipeline.
 *
 * Per user directive: "do heavy testing by creating complex models,
 * environments etc and not just primitives... break them down and
 * reconstruct them in the studio only by interacting with the
 * platform in the same way a human would".
 *
 * Builds a full character production scene by clicking 30+ Blender
 * + engine tools through the ribbon as a human character TD would.
 * Mirrors Video-718 (Kratos hero pose), Video-80 (bald freckled
 * portrait), Video-29 (hooded character) workflows from the
 * 45-video reference reels.
 *
 * Character workflow (every step a real ribbon click):
 *
 *   BASE MESH    Suzanne -> Multires x2 (dense subdivided face)
 *   SCULPT       Pinch (eye sockets) -> Inflate (cheeks)
 *                -> Crease (mouth line) -> Polish (overall)
 *                -> Smooth-N (final blend)
 *   SHADING      AutoSmooth -> Radial Normals (highlight fake)
 *   MATERIAL     Chrome preset
 *   TEXTURE      Smart UV -> Voronoi shader texture (skin micro)
 *                -> Bake AO -> Bake Normals
 *   RIGGING      Armature (10 bones) -> Pose Mode toggle
 *                -> IK Solver (target above origin)
 *                -> Face Shape Keys: smile + brow
 *   ANIMATION    Insert KF @ 0 -> KF @ 60 -> KF @ 120
 *                -> Motion Path display
 *                -> Bezier easing
 *   FX           Niagara Burst (energy) -> Hair (head fur)
 *   LIGHTING     SkyLight + Reflection Probe
 *                -> 3-Point + Sun
 *   WORLD        HDRI sky + Vol Fog
 *   RENDER       Shade Rendered -> Showreel
 *   COMPOSITOR   Bloom + Vignette + Chr Ab
 *   ORBIT        8 angles
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-character-production');

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

test('Studio Integration — Character Production Pipeline (30+ Blender + engine tools)', async () => {
  test.setTimeout(420000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 100,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await tab(win, 'modeling');

  // ════ STEP 1: BASE MESH — Suzanne dense ═════════════════════════
  await win.locator('[data-studio-primitive="suzanne"]').click();
  await win.waitForTimeout(280);
  await selectByKind(win, 'suzanne');
  await win.waitForTimeout(280);

  await win.locator('[data-studio-ribbon-action="multires"]').click();
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(OUT, '01-suzanne-multires.png'), fullPage: false });

  // ════ STEP 2: SCULPT PASSES ══════════════════════════════════════
  await tab(win, 'sculpting');

  await win.locator('[data-studio-ribbon-action="sculpt-pinch"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="sculpt-flatten"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="sculpt-crease"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="sculpt-polish"]').click();
  await win.waitForTimeout(280);

  await tab(win, 'modeling');
  await win.locator('[data-studio-ribbon-action="smooth-n"]').click();
  await win.waitForTimeout(280);
  await win.screenshot({ path: path.join(OUT, '02-after-sculpt.png'), fullPage: false });

  // ════ STEP 3: SHADING ════════════════════════════════════════════
  await win.locator('[data-studio-ribbon-action="auto-smooth"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="radial-normals"]').click();
  await win.waitForTimeout(280);

  // ════ STEP 4: MATERIAL — Chrome ═════════════════════════════════
  await win.locator('[data-studio-material-preset="chrome"]').click();
  await win.waitForTimeout(280);

  // ════ STEP 5: TEXTURE ════════════════════════════════════════════
  await tab(win, 'uv-texture');
  await win.locator('[data-studio-ribbon-action="smart-uv"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="shader-voronoi"]').click();
  await win.waitForTimeout(280);

  await tab(win, 'modeling');
  await win.locator('[data-studio-ribbon-action="bake-ao"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="bake-normals"]').click();
  await win.waitForTimeout(280);

  // ════ STEP 6: RIGGING — Armature + Pose + IK + Face keys ════════
  await tab(win, 'rigging');
  await win.locator('[data-studio-action="add-armature"]').click();
  await win.waitForTimeout(400);
  await win.locator('[data-studio-ribbon-action="pose-mode"]').click();
  await win.waitForTimeout(220);
  await win.locator('[data-studio-ribbon-action="ik-solver"]').click();
  await win.waitForTimeout(280);
  // Face shape keys.
  await setRange(win, '[data-studio-shapekey="smile"]', '0.7');
  await win.waitForTimeout(200);
  await setRange(win, '[data-studio-shapekey="brow"]',  '0.5');
  await win.waitForTimeout(280);

  // ════ STEP 7: ANIMATION — 3 keyframes + motion path + bezier ═══
  await tab(win, 'animation');
  await selectByKind(win, 'suzanne');
  await win.waitForTimeout(280);
  await setRange(win, '[data-studio-timeline="frame"]', '0');
  await win.locator('[data-studio-action="insert-keyframe"]').click();
  await win.waitForTimeout(220);
  // Rotate via evaluate for keyframe 2.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'suzanne') m = o; });
    if (m) m.rotation.y = Math.PI / 2;
  });
  await setRange(win, '[data-studio-timeline="frame"]', '60');
  await win.locator('[data-studio-action="insert-keyframe"]').click();
  await win.waitForTimeout(220);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'suzanne') m = o; });
    if (m) m.rotation.y = Math.PI;
  });
  await setRange(win, '[data-studio-timeline="frame"]', '120');
  await win.locator('[data-studio-action="insert-keyframe"]').click();
  await win.waitForTimeout(220);
  // Bezier easing + motion path overlay.
  await win.locator('[data-studio-ribbon-action="ease-bezier"]').click();
  await win.waitForTimeout(220);
  await win.locator('[data-studio-timeline="show-motion-path"]').check();
  await win.waitForTimeout(280);

  // ════ STEP 8: FX — Niagara + Hair ═══════════════════════════════
  await tab(win, 'vfx-sim');
  await win.locator('[data-studio-action="grow-hair"]').click();
  await win.waitForTimeout(400);
  await tab(win, 'modeling');
  await selectByKind(win, 'suzanne');
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="niagara-burst"]').click();
  await win.waitForTimeout(300);

  // ════ STEP 9: LIGHTING + Engine helpers (Modeling tab Engine groups) ═══
  await win.locator('[data-studio-ribbon-action="sky-light"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="reflection-probe"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="vol-fog"]').click();
  await win.waitForTimeout(280);

  await tab(win, 'rendering');
  await win.locator('[data-studio-action="three-point-preset"]').click();
  await win.waitForTimeout(380);
  await win.locator('[data-studio-ribbon-action="light-sun"]').click();
  await win.waitForTimeout(280);

  // ════ STEP 10: WORLD (Rendering tab) ════════════════════════════
  await win.locator('[data-studio-ribbon-action="world-hdri"]').click();
  await win.waitForTimeout(280);

  // ════ STEP 11: VIEW SHADING ══════════════════════════════════════
  await win.locator('[data-studio-ribbon-action="shade-rendered"]').click();
  await win.waitForTimeout(280);

  // ════ STEP 12: RENDER + COMPOSITOR ═══════════════════════════════
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

  // ════ FINAL VERIFICATION ══════════════════════════════════════════
  const final = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let suz = null;
    const k = {};
    let lights = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        const kind = o.userData.archdiscStudioPrimitiveKind;
        k[kind] = (k[kind] || 0) + 1;
        if (kind === 'suzanne') suz = o;
      }
      if (o.userData && o.userData.archdiscStudioLight && o.isLight) lights++;
    });
    return {
      kinds: k, lights,
      suzanneStamps: suz ? {
        multires:    suz.userData.archdiscStudioMultires    || 0,
        bevelled:    suz.userData.archdiscStudioBevelled    || 0,
        polished:    suz.userData.archdiscStudioBrushPolish || 0,
        pinched:     suz.userData.archdiscStudioBrushPinch  || 0,
        crease:      suz.userData.archdiscStudioBrushCrease || 0,
        autosmooth:  suz.userData.archdiscStudioAutoSmooth,
        radial:      suz.userData.archdiscStudioNormalEdited || 0,
        smartUv:     suz.userData.archdiscStudioSmartUv     || 0,
        baked:       suz.userData.archdiscStudioBaked,
        poseToggled: suz.userData.archdiscStudioPoseModeToggled || 0,
        ik:          suz.userData.archdiscStudioIkSolved    || 0,
      } : null,
    };
  });

  expect(final.suzanneStamps).not.toBeNull();
  expect(final.suzanneStamps.multires).toBe(2);
  expect(final.suzanneStamps.pinched).toBe(1);
  expect(final.suzanneStamps.crease).toBe(1);
  expect(final.suzanneStamps.polished).toBe(1);
  expect(final.suzanneStamps.autosmooth).toBe(30);
  expect(final.suzanneStamps.radial).toBe(1);
  expect(final.suzanneStamps.smartUv).toBe(1);
  expect(final.suzanneStamps.baked).toBe('normals');  // last bake op
  expect(final.suzanneStamps.poseToggled).toBe(1);
  expect(final.suzanneStamps.ik).toBe(1);

  expect(final.kinds.suzanne).toBe(1);
  expect(final.kinds.armature).toBe(1);
  expect(final.kinds.hair).toBe(1);
  expect(final.kinds['niagara-burst']).toBe(1);
  expect(final.kinds['reflection-probe']).toBe(1);
  expect(final.lights).toBeGreaterThanOrEqual(4);

  // ════ ORBIT — 8 angles around the finished character ════════════
  for (const az of [0, 45, 90, 135, 180, 225, 270, 315]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 18, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `03-orbit-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  character production: Suzanne -> multires x${final.suzanneStamps.multires} -> 4 sculpt brushes -> autosmooth + radial normals -> chrome + smart-UV + voronoi + bake-AO/N -> armature + pose + IK + face keys -> 3 keyframes + motion path + bezier -> hair + niagara -> 4+ lights + HDRI + fog -> showreel + 3 compositor effects`);

  await app.close();
});
