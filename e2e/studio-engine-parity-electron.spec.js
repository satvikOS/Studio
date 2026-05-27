import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 92 — Game-engine parity batch 1.
 *
 * User directive: "studio must be 1:1 or better parity with Unreal
 * engine, unity, RAGE or other big engines(MUST, put it in memory)"
 *
 * Seven engine-class features ported into Studio's Modeling-tab
 * ribbon as a new "Engine · Unreal/Unity/RAGE" group:
 *
 *   Landscape        ← Unreal Landscape / Unity Terrain
 *   NavMesh          ← Unreal NavigationSystem / Unity NavMesh
 *   Reflection Probe ← Unreal SphereReflectionCapture / Unity Refl Probe
 *   SkyLight         ← Unreal SkyLight / Unity ambient skybox
 *   Foliage          ← Unreal Foliage paint / Unity Tree+Detail painter
 *   Trigger Volume   ← Unreal TriggerVolume / Unity Collider.isTrigger
 *   Audio Source     ← Unreal AudioComponent / Unity AudioSource
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-engine-parity');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

test('Studio game-engine parity — 7 engine-class features fire through ribbon', async () => {
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

  // ---- Landscape (Unreal Landscape) ----
  await win.locator('[data-studio-ribbon-action="landscape"]').click();
  await win.waitForTimeout(400);
  const landscape = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let n = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'landscape') n++; });
    return n;
  });
  expect(landscape).toBe(1);
  await win.screenshot({ path: path.join(OUT, '01-landscape.png'), fullPage: false });

  // ---- NavMesh (Unreal NavigationSystem) ----
  await selectByKind(win, 'landscape');
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="navmesh"]').click();
  await win.waitForTimeout(400);
  const navmesh = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let n = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'navmesh-overlay') n++; });
    return n;
  });
  expect(navmesh).toBe(1);

  // ---- Foliage (Unreal Foliage paint) ----
  await win.locator('[data-studio-ribbon-action="foliage"]').click();
  await win.waitForTimeout(500);
  const foliage = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let n = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'foliage') n++; });
    return n;
  });
  expect(foliage).toBe(1);
  await win.screenshot({ path: path.join(OUT, '02-landscape-with-foliage.png'), fullPage: false });

  // ---- Reflection Probe (Unreal SphereReflectionCapture) ----
  await win.locator('[data-studio-ribbon-action="reflection-probe"]').click();
  await win.waitForTimeout(300);
  const probe = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let n = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'reflection-probe') n++; });
    return n;
  });
  expect(probe).toBe(1);

  // ---- SkyLight (Unreal SkyLight) ----
  await win.locator('[data-studio-ribbon-action="sky-light"]').click();
  await win.waitForTimeout(300);
  const skyLight = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let n = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioLightType === 'skylight') n++;
    });
    return n;
  });
  expect(skyLight).toBe(1);

  // ---- Trigger Volume (Unreal TriggerVolume) ----
  await win.locator('[data-studio-ribbon-action="trigger-volume"]').click();
  await win.waitForTimeout(300);
  const trigger = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let n = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'trigger-volume') n++; });
    return n;
  });
  expect(trigger).toBe(1);

  // ---- Audio Source (Unreal AudioComponent) ----
  await win.locator('[data-studio-ribbon-action="audio-source"]').click();
  await win.waitForTimeout(300);
  const audio = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let n = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'audio-source') n++; });
    return n;
  });
  expect(audio).toBe(1);
  await win.screenshot({ path: path.join(OUT, '03-full-engine-scene.png'), fullPage: false });

  // 4-angle showcase of the full level.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 28, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `04-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  engine parity batch 1: landscape + navmesh + foliage + reflection probe + sky light + trigger volume + audio source = 7 engine features`);

  await app.close();
});
