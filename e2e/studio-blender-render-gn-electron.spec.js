import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 84 — Render engines + Geometry Nodes.
 *
 * Render engines (Rendering tab):
 *   Cycles / EEVEE / Workbench  <- blender/source/blender/render/intern/pipeline.cc
 *
 * Geometry Nodes (Modeling tab):
 *   Mesh→Points       <- nodes/geometry/node_geo_mesh_to_points.cc
 *   Convex Hull       <- nodes/geometry/node_geo_convex_hull.cc
 *   Distribute Pts    <- nodes/geometry/node_geo_distribute_points_on_faces.cc
 *   Join Geometry     <- nodes/geometry/node_geo_join_geometry.cc
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-render-gn');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

test('Studio Blender render engines + geometry nodes', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 150,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- RENDER ENGINES ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rendering"]').click();
  await win.waitForTimeout(300);

  for (const engine of ['cycles', 'eevee', 'workbench']) {
    await win.locator(`[data-studio-ribbon-action="engine-${engine}"]`).click();
    await win.waitForTimeout(200);
    const selected = await win.evaluate(() => {
      const sel = document.querySelector('[data-studio-render="engine"]');
      return sel ? sel.value : null;
    });
    expect(selected).toBe(engine);
  }
  await win.screenshot({ path: path.join(OUT, '01-render-engines.png'), fullPage: false });

  // ---- GEOMETRY NODES ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="modeling"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);

  // Mesh → Points: should create a new gn-mesh-to-points primitive.
  await win.locator('[data-studio-ribbon-action="gn-mesh-to-points"]').click();
  await win.waitForTimeout(400);
  const meshToPoints = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let n = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'gn-mesh-to-points') n++;
    });
    return n;
  });
  expect(meshToPoints).toBe(1);

  // Distribute Points: another new primitive.
  await win.locator('[data-studio-ribbon-action="gn-distribute"]').click();
  await win.waitForTimeout(400);
  const distrib = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let n = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'gn-distribute-points') n++;
    });
    return n;
  });
  expect(distrib).toBe(1);
  await win.screenshot({ path: path.join(OUT, '02-after-points-distribute.png'), fullPage: false });

  // Convex Hull: rebuild sphere as convex hull approximation.
  await win.locator('[data-studio-ribbon-action="gn-convex-hull"]').click();
  await win.waitForTimeout(400);
  const convexCounter = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    return m ? (m.userData.archdiscStudioGnConvexHull || 0) : 0;
  });
  expect(convexCounter).toBe(1);

  // Join Geometry: needs ≥ 2 THREE.Mesh primitives. Add a cube so
  // there are 2 meshes (sphere-as-convex-hull + cube) to join.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="gn-join"]').click();
  await win.waitForTimeout(400);
  const joined = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let n = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'gn-joined') n++;
    });
    return n;
  });
  expect(joined).toBe(1);
  await win.screenshot({ path: path.join(OUT, '03-joined.png'), fullPage: false });

  // 4-angle showcase.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `04-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender render+gn: 3 engines selected (cycles/eevee/workbench); 4 geometry nodes fired (mesh→points, distribute, convex hull, join)`);

  await app.close();
});
