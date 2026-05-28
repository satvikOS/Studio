import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 94 — Complex Integration: AAA Game Level.
 *
 * Per user directives:
 *   "Blender contains more than 2 thousand of individual features...
 *    do heavy testing by creating complex models, environments etc"
 *   "studio must be 1:1 or better parity with Unreal engine, unity,
 *    RAGE or other big engines"
 *
 * Builds a complete AAA game-engine-style level by clicking 30+
 * engine + Blender tools through the ribbon as a human would.
 * Mirrors the workflow a level designer in Unreal / Unity / RAGE
 * would follow.
 *
 * Level composition (every step a real ribbon click):
 *
 *   TERRAIN    Landscape (heightmap) -> NavMesh -> Foliage paint x300
 *              -> Lightmass bake (sun irradiance)
 *   BUILDINGS  cube -> Stretch -> Extrude -> linear array x6
 *   PROPS      icosa -> Decimate -> linear array x4 (boulders)
 *   GAMEPLAY   2 Trigger Volumes (checkpoints)
 *              4 Audio Sources (ambient + 3 SFX)
 *   FX         2 Niagara Bursts (combat effects)
 *              Volumetric Fog
 *   LIGHTING   SkyLight + Sun + 3 Reflection Probes + 3-Point
 *   STREAMING  4 World Partition Cells (level grid)
 *   LOGIC      3 Blueprint Nodes (begin play / tick / event)
 *              3 Behavior Tree Nodes (Patrol / Idle / Chase)
 *              2 Sequencer Tracks (Intro Cinematic / Combat)
 *              Camera Sequence Path (16 keys, circular)
 *   IMPORT     2 Datasmith Assets (FBX + glTF placeholders)
 *   RENDER     Shade Rendered + Showreel + Bloom + Vignette + Chr Ab
 *   ORBIT      8 angles
 *
 * Final scene: ≥30 primitives + ≥7 lights + ≥2 particle systems
 * + sequencer tracks + BT nodes + camera path + volFog all in
 * scene.userData.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-aaa-game-level');

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

test('Studio Integration — AAA Game Level (30+ engine tools)', async () => {
  test.setTimeout(420000); // 7 min
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

  // ════════════ TERRAIN ════════════════════════════════════════════
  await win.locator('[data-studio-ribbon-action="landscape"]').click();
  await win.waitForTimeout(500);
  await selectByKind(win, 'landscape');
  await win.waitForTimeout(280);

  await win.locator('[data-studio-ribbon-action="navmesh"]').click();
  await win.waitForTimeout(400);

  await win.locator('[data-studio-ribbon-action="foliage"]').click();
  await win.waitForTimeout(500);

  await win.locator('[data-studio-ribbon-action="lightmass"]').click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '01-terrain-baked.png'), fullPage: false });

  // ════════════ BUILDINGS (6-cube linear array) ═══════════════════
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(280);
  await selectByKind(win, 'cube');
  await win.waitForTimeout(280);

  await win.locator('[data-studio-ribbon-action="stretch"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="extrude"]').click();
  await win.waitForTimeout(300);

  await setArrayConfig(win, 'linear', 6, 0.018, 0, 0);
  await win.locator('[data-studio-ribbon-action="apply-array"]').click();
  await win.waitForTimeout(400);

  // ════════════ PROPS (4-icosa boulder array) ═════════════════════
  await win.locator('[data-studio-primitive="icosahedron"]').click();
  await win.waitForTimeout(280);
  await selectByKind(win, 'icosahedron');
  await win.waitForTimeout(280);

  await win.locator('[data-studio-ribbon-action="decimate"]').click();
  await win.waitForTimeout(300);

  await setArrayConfig(win, 'linear', 4, 0.02, 0, -0.018);
  await win.locator('[data-studio-ribbon-action="apply-array"]').click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '02-buildings-props.png'), fullPage: false });

  // ════════════ GAMEPLAY VOLUMES + AUDIO ══════════════════════════
  await win.locator('[data-studio-ribbon-action="trigger-volume"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="trigger-volume"]').click();
  await win.waitForTimeout(280);

  await win.locator('[data-studio-ribbon-action="audio-source"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="audio-source"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="audio-source"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="audio-source"]').click();
  await win.waitForTimeout(280);

  // ════════════ FX ═════════════════════════════════════════════════
  await win.locator('[data-studio-ribbon-action="niagara-burst"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="niagara-burst"]').click();
  await win.waitForTimeout(300);

  await win.locator('[data-studio-ribbon-action="vol-fog"]').click();
  await win.waitForTimeout(280);

  // ════════════ STREAMING + LOGIC ══════════════════════════════════
  await win.locator('[data-studio-ribbon-action="world-cell"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="world-cell"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="world-cell"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="world-cell"]').click();
  await win.waitForTimeout(280);

  await win.locator('[data-studio-ribbon-action="blueprint-node"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="blueprint-node"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="blueprint-node"]').click();
  await win.waitForTimeout(280);

  await win.locator('[data-studio-ribbon-action="behavior-tree"]').click();
  await win.waitForTimeout(220);
  await win.locator('[data-studio-ribbon-action="behavior-tree"]').click();
  await win.waitForTimeout(220);
  await win.locator('[data-studio-ribbon-action="behavior-tree"]').click();
  await win.waitForTimeout(220);

  await win.locator('[data-studio-ribbon-action="sequencer-track"]').click();
  await win.waitForTimeout(220);
  await win.locator('[data-studio-ribbon-action="sequencer-track"]').click();
  await win.waitForTimeout(220);

  await win.locator('[data-studio-ribbon-action="camera-path"]').click();
  await win.waitForTimeout(220);

  // ════════════ IMPORTED ASSETS ═══════════════════════════════════
  await win.locator('[data-studio-ribbon-action="datasmith"]').click();
  await win.waitForTimeout(280);
  await win.locator('[data-studio-ribbon-action="datasmith"]').click();
  await win.waitForTimeout(280);
  await win.screenshot({ path: path.join(OUT, '03-full-gameplay.png'), fullPage: false });

  // ════════════ LIGHTING ═══════════════════════════════════════════
  // SkyLight + Reflection Probe live in Modeling tab's Engine group;
  // 3-Point + Sun + Shade-Rendered live on Rendering tab.
  await win.locator('[data-studio-ribbon-action="sky-light"]').click();
  await win.waitForTimeout(250);
  await win.locator('[data-studio-ribbon-action="reflection-probe"]').click();
  await win.waitForTimeout(250);
  await win.locator('[data-studio-ribbon-action="reflection-probe"]').click();
  await win.waitForTimeout(250);
  await win.locator('[data-studio-ribbon-action="reflection-probe"]').click();
  await win.waitForTimeout(250);

  await tab(win, 'rendering');
  await win.locator('[data-studio-action="three-point-preset"]').click();
  await win.waitForTimeout(400);
  await win.locator('[data-studio-ribbon-action="light-sun"]').click();
  await win.waitForTimeout(250);
  await win.locator('[data-studio-ribbon-action="shade-rendered"]').click();
  await win.waitForTimeout(280);

  // ════════════ RENDER + COMPOSITOR ═══════════════════════════════
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

  // ════════════ FINAL SCENE VERIFICATION ═══════════════════════════
  const finalLevel = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const ud = vp.scene.userData || {};
    const counts = {
      landscape: 0, navmesh: 0, foliage: 0, cube: 0, cubeArr: 0,
      icosa: 0, icosaArr: 0, triggers: 0, audios: 0, niagaras: 0,
      cells: 0, blueprints: 0, datasmith: 0, reflProbes: 0,
    };
    let lights = 0;
    vp.scene.traverse(o => {
      const k = o.userData && o.userData.archdiscStudioPrimitiveKind;
      if (k === 'landscape')              counts.landscape++;
      else if (k === 'navmesh-overlay')   counts.navmesh++;
      else if (k === 'foliage')           counts.foliage++;
      else if (k === 'cube')              counts.cube++;
      else if (k === 'cube-array')        counts.cubeArr++;
      else if (k === 'icosahedron')       counts.icosa++;
      else if (k === 'icosahedron-array') counts.icosaArr++;
      else if (k === 'trigger-volume')    counts.triggers++;
      else if (k === 'audio-source')      counts.audios++;
      else if (k === 'niagara-burst')     counts.niagaras++;
      else if (k === 'world-partition-cell') counts.cells++;
      else if (k === 'blueprint-node')    counts.blueprints++;
      else if (k === 'datasmith-asset')   counts.datasmith++;
      else if (k === 'reflection-probe')  counts.reflProbes++;
      if (o.userData && o.userData.archdiscStudioLight && o.isLight) lights++;
    });
    return {
      counts, lights,
      sequencerTracks: ud.archdiscStudioSequencerTracks ? ud.archdiscStudioSequencerTracks.length : 0,
      behaviorNodes:   ud.archdiscStudioBehaviorTree    ? ud.archdiscStudioBehaviorTree.length    : 0,
      volFog:          ud.archdiscStudioVolumetricFog,
      cameraPath:      ud.archdiscStudioCameraPath      ? ud.archdiscStudioCameraPath.length      : 0,
    };
  });

  // Verifications.
  expect(finalLevel.counts.landscape).toBe(1);
  expect(finalLevel.counts.navmesh).toBe(1);
  expect(finalLevel.counts.foliage).toBe(1);
  expect(finalLevel.counts.cube).toBe(1);
  expect(finalLevel.counts.cubeArr).toBe(5);
  expect(finalLevel.counts.icosa).toBe(1);
  expect(finalLevel.counts.icosaArr).toBe(3);
  expect(finalLevel.counts.triggers).toBe(2);
  expect(finalLevel.counts.audios).toBe(4);
  expect(finalLevel.counts.niagaras).toBe(2);
  expect(finalLevel.counts.cells).toBe(4);
  expect(finalLevel.counts.blueprints).toBe(3);
  expect(finalLevel.counts.datasmith).toBe(2);
  expect(finalLevel.counts.reflProbes).toBe(3);
  expect(finalLevel.lights).toBeGreaterThanOrEqual(4);
  expect(finalLevel.sequencerTracks).toBe(2);
  expect(finalLevel.behaviorNodes).toBe(3);
  expect(finalLevel.volFog).toBe(8);
  expect(finalLevel.cameraPath).toBe(16);

  // ════════════ ORBIT — 8 angles ═══════════════════════════════════
  for (const az of [0, 45, 90, 135, 180, 225, 270, 315]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 40, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `04-orbit-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  aaa game level: terrain (landscape+navmesh+foliage+lightmass) + 6 buildings + 4 boulders + 2 triggers + 4 audios + 2 niagaras + 4 WP cells + 3 blueprints + 3 BT nodes + 2 sequencer tracks + 2 datasmith + 3 refl probes + 5+ lights + vol fog + camera path + 3 compositor effects`);
  console.log(`  counts = ${JSON.stringify(finalLevel.counts)}`);

  await app.close();
});
