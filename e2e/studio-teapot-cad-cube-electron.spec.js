import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 70 — Teapot + CAD Cube primitives imported from Blender X3D.
 *
 * Two new vendored-Blender primitives:
 *   - teapot     — Utah teapot (Martin Newell, 1975), from
 *                  blender/tests/files/io_tests/x3d/teapot.x3d.
 *                  257 verts, 512 tris.
 *   - color-cube — 6-face CAD fixture cube from the same dir.
 *                  8 verts, 12 tris.
 *
 * Both are emitted by tools/import_teapot_and_colorcube.js (mirrors
 * the import_suzanne.py pattern) into TeapotGeometry.js / ColorCube
 * Geometry.js, then registered as first-class Studio primitives.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-teapot-cad-cube');

test('Studio Blender X3D import — Teapot + CAD Cube primitives spawn cleanly', async () => {
  test.setTimeout(120000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 2200,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Both ribbon buttons exist.
  await expect(win.locator('[data-studio-primitive="teapot"]')).toBeVisible();
  await expect(win.locator('[data-studio-primitive="color-cube"]')).toBeVisible();

  // Spawn the teapot.
  await win.locator('[data-studio-primitive="teapot"]').click();
  await win.waitForTimeout(300);

  const teapotStats = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'teapot') m = o; });
    if (!m) return null;
    return {
      verts: m.geometry.attributes.position.count,
      tris:  m.geometry.index.count / 3,
    };
  });
  expect(teapotStats).not.toBeNull();
  expect(teapotStats.verts).toBe(257); // matches import-script output
  expect(teapotStats.tris).toBe(512);
  await win.screenshot({ path: path.join(OUT, '01-teapot.png'), fullPage: false });

  // Spawn the color cube.
  await win.locator('[data-studio-primitive="color-cube"]').click();
  await win.waitForTimeout(300);

  const cubeStats = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'color-cube') m = o; });
    if (!m) return null;
    return {
      verts: m.geometry.attributes.position.count,
      tris:  m.geometry.index.count / 3,
    };
  });
  expect(cubeStats).not.toBeNull();
  expect(cubeStats.verts).toBe(8);
  expect(cubeStats.tris).toBe(12);

  // ---- 4-angle showcase ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `02-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender x3d import: teapot ${teapotStats.verts}v/${teapotStats.tris}t + cad cube ${cubeStats.verts}v/${cubeStats.tris}t spawned cleanly`);

  await app.close();
});
