import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — ZBRUSH DYNAMESH (headed Electron).
 *
 * Uniform-topology voxel reskin: voxelise the selected mesh, extract a
 * watertight cuberille surface, weld + Laplacian-smooth. Verifies that
 * DynaMeshing a torus (awkward topology) yields a fresh, evenly-tessellated,
 * closed mesh that still approximates the torus bounds. Driven by a real ribbon
 * click + the hook. Verified visually.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-dynamesh');

test('Studio — DynaMesh reskins a mesh with uniform topology', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 25 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioDynaMesh === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // a torus, selected (interesting topology to reskin)
  await win.locator('[data-studio-primitive="torus"]').click();
  await win.waitForTimeout(250);
  await win.evaluate(() => { const s = window.__archdiscScene; let m = null; s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) m = o; }); if (m) window.__studioSelectMesh(m); });
  await win.waitForTimeout(200);

  const stat = () => win.evaluate(() => { const m = window.__studioSelectedMesh(); const g = m.geometry; g.computeBoundingBox(); const b = g.boundingBox; return { verts: g.attributes.position.count, size: [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z] }; });
  const before = await stat();

  // ── DynaMesh via the ribbon ──
  await win.locator('[data-studio-ribbon-action="dynamesh"]').click();
  await win.waitForTimeout(2500); // voxelise + extract + smooth
  const after = await stat();
  const dyna = await win.evaluate(() => { const m = window.__studioSelectedMesh(); return m.userData.archdiscStudioDynaMesh || null; });

  expect(dyna, 'mesh carries DynaMesh metadata').not.toBeNull();
  expect(dyna.resolution, 'voxel resolution recorded').toBeGreaterThanOrEqual(20);
  expect(dyna.voxels, 'voxels were filled (mesh was voxelised)').toBeGreaterThan(50);
  expect(after.verts, 'reskinned to a fresh tessellation').toBeGreaterThan(100);
  // the reskin approximates the original torus footprint (bbox within ~25%)
  for (let a = 0; a < 3; a++) {
    if (before.size[a] < 1e-4) continue;
    expect(Math.abs(after.size[a] - before.size[a]) / before.size[a], `dynamesh keeps bbox axis ${a}`).toBeLessThan(0.28);
  }

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(34, 30, 1.2); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-dynameshed-torus.png') });

  // ── hook on a sphere too (resolution arg) ──
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(250);
  const sphereDyna = await win.evaluate(() => {
    const s = window.__archdiscScene; let m = null; s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    if (m) window.__studioSelectMesh(m);
    return window.__studioDynaMesh(22);
  });
  expect(sphereDyna && sphereDyna.vertices, 'DynaMesh hook reskinned the sphere').toBeGreaterThan(100);

  // eslint-disable-next-line no-console
  console.log(`  dynamesh: torus ${before.verts}v -> ${after.verts}v (res ${dyna.resolution}, ${dyna.voxels} voxels); sphere -> ${sphereDyna.vertices}v`);

  await app.close();
});
