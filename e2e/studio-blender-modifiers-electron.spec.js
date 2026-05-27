import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 73 — Three more Blender-source-cited modifiers spread
 * across Studio's UI:
 *
 *   Solidify  ← blender/source/blender/modifiers/intern/MOD_solidify.cc
 *               (give thickness to a surface — outer + inner shells)
 *   Cast      ← .../MOD_cast.cc
 *               (push verts toward bounding sphere or cuboid)
 *   Wave      ← .../MOD_wave.cc
 *               (sinusoidal radial Y displacement)
 *
 * All four wired into the Modeling-tab ribbon's new "Blender · Mods"
 * group. This spec exercises each one in turn.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-modifiers');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function meshState(win, kind) {
  return await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (!m) return null;
    const pos = m.geometry.attributes.position;
    let sum = 0;
    for (let i = 0; i < pos.count; i++) sum += Math.abs(pos.getX(i)) + Math.abs(pos.getY(i)) + Math.abs(pos.getZ(i));
    return {
      verts: pos.count,
      checksum: sum,
      solidified: m.userData.archdiscStudioSolidified || 0,
      cast: m.userData.archdiscStudioCast || 0,
      waved: m.userData.archdiscStudioWaved || 0,
    };
  }, kind);
}

test('Studio Blender-source modifiers — Solidify / Cast / Wave wired through ribbon', async () => {
  test.setTimeout(120000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 220,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- Ribbon group exists ----
  await expect(win.locator('[data-studio-ribbon-action="solidify"]')).toBeVisible();
  await expect(win.locator('[data-studio-ribbon-action="cast-sphere"]')).toBeVisible();
  await expect(win.locator('[data-studio-ribbon-action="cast-cuboid"]')).toBeVisible();
  await expect(win.locator('[data-studio-ribbon-action="wave"]')).toBeVisible();

  // ---- SOLIDIFY ----
  // Suzanne has no thickness; solidify doubles its mesh as a shell.
  await win.locator('[data-studio-primitive="suzanne"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'suzanne');
  await win.waitForTimeout(300);

  const suzanneBaseline = await meshState(win, 'suzanne');
  await win.locator('[data-studio-ribbon-action="solidify"]').click();
  await win.waitForTimeout(400);
  const afterSolidify = await meshState(win, 'suzanne');
  // Vert count exactly doubles (outer + inner shells).
  expect(afterSolidify.verts).toBe(suzanneBaseline.verts * 2);
  expect(afterSolidify.solidified).toBe(1);
  await win.screenshot({ path: path.join(OUT, '01-suzanne-solidified.png'), fullPage: false });

  // ---- CAST → SPHERE ----
  // Cast a cylinder (verts at varying radii — top/bottom rings closer
  // to center axis than the cylinder body) toward its bounding sphere.
  await win.locator('[data-studio-action="clear-scene-ribbon"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="cylinder"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'cylinder');
  await win.waitForTimeout(300);

  const cylBaseline = await meshState(win, 'cylinder');
  await win.locator('[data-studio-ribbon-action="cast-sphere"]').click();
  await win.waitForTimeout(400);
  const afterCastSph = await meshState(win, 'cylinder');
  expect(afterCastSph.cast).toBe(1);
  expect(Math.abs(afterCastSph.checksum - cylBaseline.checksum)).toBeGreaterThan(0.001);
  await win.screenshot({ path: path.join(OUT, '02-cylinder-cast-sphere.png'), fullPage: false });

  // ---- CAST → CUBOID ----
  // Spawn a sphere, cast to cuboid — verts pushed to bbox surface.
  await win.locator('[data-studio-action="clear-scene-ribbon"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);

  const sphBaseline = await meshState(win, 'sphere');
  await win.locator('[data-studio-ribbon-action="cast-cuboid"]').click();
  await win.waitForTimeout(400);
  const afterCastCub = await meshState(win, 'sphere');
  expect(afterCastCub.cast).toBe(1);
  expect(Math.abs(afterCastCub.checksum - sphBaseline.checksum)).toBeGreaterThan(0.001);
  await win.screenshot({ path: path.join(OUT, '03-sphere-cast-cuboid.png'), fullPage: false });

  // ---- WAVE ----
  // Spawn a plane, subdivide twice (need verts), apply wave.
  await win.locator('[data-studio-action="clear-scene-ribbon"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="plane"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'plane');
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="subdivide"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="subdivide"]').click();
  await win.waitForTimeout(300);

  const planeBaseline = await meshState(win, 'plane');
  await win.locator('[data-studio-ribbon-action="wave"]').click();
  await win.waitForTimeout(400);
  const afterWave = await meshState(win, 'plane');
  expect(afterWave.waved).toBe(1);
  expect(Math.abs(afterWave.checksum - planeBaseline.checksum)).toBeGreaterThan(0.001);

  // 4-angle orbit captures of the wave plane.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `04-wave-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender mods: solidify suzanne (${suzanneBaseline.verts} -> ${afterSolidify.verts} v), cast cube->sph, cast sphere->cub, wave plane (3 modifiers fired)`);

  await app.close();
});
