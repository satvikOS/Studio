import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 81 — Warp + Normal Edit (Radial).
 *
 *   Warp        <- blender/source/blender/modifiers/intern/MOD_warp.cc
 *                  Distance-falloff vertex displacement: verts near
 *                  centre move by full offset, verts at perimeter
 *                  don't move at all.
 *   Radial-N    <- blender/source/blender/modifiers/intern/MOD_normal_edit.cc
 *                  (RADIAL_FROM_CENTER) Override normals to point
 *                  outward from bounding-sphere centre.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-warp-normaledit');

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
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    const nrm = m.geometry.attributes.normal;
    // Sample 5 vertex normals to verify the radial override.
    const samples = [];
    if (nrm) for (let i = 0; i < Math.min(5, nrm.count); i++) {
      samples.push([nrm.getX(i), nrm.getY(i), nrm.getZ(i)]);
    }
    return {
      verts: m.geometry.attributes.position.count,
      heightY: bb.max.y - bb.min.y,
      sampleNormals: samples,
      warped: m.userData.archdiscStudioWarped || 0,
      normalEdited: m.userData.archdiscStudioNormalEdited || 0,
    };
  }, kind);
}

test('Studio Blender Warp + Radial Normals — both fire', async () => {
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

  // ---- WARP on a subdivided plane -> creates a bump in the middle. ----
  await win.locator('[data-studio-primitive="plane"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'plane');
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="subdivide"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="subdivide"]').click();
  await win.waitForTimeout(300);
  const planeBaseline = await meshState(win, 'plane');
  await win.locator('[data-studio-ribbon-action="warp"]').click();
  await win.waitForTimeout(400);
  const afterWarp = await meshState(win, 'plane');
  expect(afterWarp.warped).toBe(1);
  // Y range should grow (the central bump pushes up).
  expect(afterWarp.heightY).toBeGreaterThan(planeBaseline.heightY);
  await win.screenshot({ path: path.join(OUT, '01-plane-warped.png'), fullPage: false });

  // ---- RADIAL NORMALS on a sphere ----
  await win.locator('[data-studio-action="clear-scene-ribbon"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="radial-normals"]').click();
  await win.waitForTimeout(400);
  const afterRadial = await meshState(win, 'sphere');
  expect(afterRadial.normalEdited).toBe(1);
  // Every sampled normal should be a unit vector.
  for (const [nx, ny, nz] of afterRadial.sampleNormals) {
    const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
    expect(mag).toBeCloseTo(1.0, 4);
  }
  await win.screenshot({ path: path.join(OUT, '02-sphere-radial-normals.png'), fullPage: false });

  // 4-angle showcase.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `03-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender warp + normal-edit: plane warped (y ${planeBaseline.heightY.toFixed(4)} -> ${afterWarp.heightY.toFixed(4)}); sphere normals overridden, all unit length`);

  await app.close();
});
