import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 93 — Engine parity batch 2: 10 more Unreal/Unity features:
 *   Material Instance     <- Unreal MaterialInstance
 *   Blueprint Node        <- Unreal Blueprint / Unity Visual Scripting
 *   Sequencer Track       <- Unreal Sequencer / Unity Timeline
 *   Behavior Tree Node    <- Unreal BT
 *   Datasmith Import      <- Unreal Datasmith / Unity FBX
 *   Lightmass Bake        <- Unreal Lightmass / Unity Progressive Lightmapper
 *   World Partition Cell  <- Unreal World Partition / Unity Addressables
 *   Volumetric Fog        <- Unreal Volumetric Fog / Unity SkyFogVolume
 *   Camera Sequence Path  <- Unreal Camera Component sequencer track
 *   Niagara Burst         <- Unreal Niagara burst / Unity ParticleSystem.Emit
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-engine-parity-batch2');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

test('Studio engine parity 2 — Material/Blueprint/Sequencer/BT/Datasmith/Lightmass/WP/VolFog/CamPath/Niagara', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 120,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Stage a sphere — used for Material Instance + Lightmass.
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);

  // ---- Material Instance ----
  await win.locator('[data-studio-ribbon-action="material-instance"]').click();
  await win.waitForTimeout(300);
  const matInst = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    return m ? m.userData.archdiscStudioMaterialInstance : 0;
  });
  expect(matInst).toBe(1);

  // ---- Blueprint Node ----
  await win.locator('[data-studio-ribbon-action="blueprint-node"]').click();
  await win.waitForTimeout(300);

  // ---- Sequencer Track ----
  await win.locator('[data-studio-ribbon-action="sequencer-track"]').click();
  await win.waitForTimeout(200);

  // ---- Behavior Tree Node ----
  await win.locator('[data-studio-ribbon-action="behavior-tree"]').click();
  await win.waitForTimeout(200);

  // ---- Datasmith Import ----
  await win.locator('[data-studio-ribbon-action="datasmith"]').click();
  await win.waitForTimeout(300);

  // ---- Lightmass Bake ----
  await win.locator('[data-studio-ribbon-action="lightmass"]').click();
  await win.waitForTimeout(300);
  const lightmass = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    return m ? m.userData.archdiscStudioLightmassBaked : 0;
  });
  expect(lightmass).toBe(1);

  // ---- World Partition Cell ----
  await win.locator('[data-studio-ribbon-action="world-cell"]').click();
  await win.waitForTimeout(300);

  // ---- Volumetric Fog ----
  await win.locator('[data-studio-ribbon-action="vol-fog"]').click();
  await win.waitForTimeout(200);

  // ---- Camera Sequence Path ----
  await win.locator('[data-studio-ribbon-action="camera-path"]').click();
  await win.waitForTimeout(200);

  // ---- Niagara Burst ----
  await win.locator('[data-studio-ribbon-action="niagara-burst"]').click();
  await win.waitForTimeout(300);

  // Verify scene state.
  const sceneStats = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const ud = vp.scene.userData || {};
    let blueprintNodes = 0, datasmithAssets = 0, wpCells = 0, niagaraBursts = 0;
    vp.scene.traverse(o => {
      const k = o.userData && o.userData.archdiscStudioPrimitiveKind;
      if (k === 'blueprint-node') blueprintNodes++;
      else if (k === 'datasmith-asset') datasmithAssets++;
      else if (k === 'world-partition-cell') wpCells++;
      else if (k === 'niagara-burst') niagaraBursts++;
    });
    return {
      blueprintNodes, datasmithAssets, wpCells, niagaraBursts,
      sequencerTracks: ud.archdiscStudioSequencerTracks ? ud.archdiscStudioSequencerTracks.length : 0,
      behaviorNodes:   ud.archdiscStudioBehaviorTree    ? ud.archdiscStudioBehaviorTree.length    : 0,
      volFog:          ud.archdiscStudioVolumetricFog,
      cameraPath:      ud.archdiscStudioCameraPath      ? ud.archdiscStudioCameraPath.length      : 0,
    };
  });
  expect(sceneStats.blueprintNodes).toBe(1);
  expect(sceneStats.datasmithAssets).toBe(1);
  expect(sceneStats.wpCells).toBe(1);
  expect(sceneStats.niagaraBursts).toBe(1);
  expect(sceneStats.sequencerTracks).toBe(1);
  expect(sceneStats.behaviorNodes).toBe(1);
  expect(sceneStats.volFog).toBe(8);
  expect(sceneStats.cameraPath).toBe(16);

  await win.screenshot({ path: path.join(OUT, '01-after-batch2.png'), fullPage: false });

  // 4-angle showcase.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 28, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `02-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  engine parity batch 2: 10 features fired (mat·inst + blueprint + sequencer track + BT + datasmith + lightmass + WP cell + vol fog + cam path + niagara)`);

  await app.close();
});
