import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — QUAD REMESH (uniform quad-dominant retopology) (headed Electron).
 *
 * Voxelise + cuberille into genuine 4-sided QUAD faces (recorded in
 * userData.archdiscQuads), weld + smooth. Verifies the result is real quad
 * topology (every recorded face has 4 indices; the quad count matches the
 * rendered tri count = 2 tris/quad) and that it approximates the input bounds.
 * (Honest scope: UNIFORM quad remesh — field-aligned ZRemesher quad flow is a
 * further extension.) Verified visually.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-quad-remesh');

test('Studio — quad remesh produces real 4-sided quad topology', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioQuadRemesh === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // an icosahedron (all-tri, awkward) -> quad remesh
  await win.locator('[data-studio-primitive="icosahedron"]').click();
  await win.waitForTimeout(250);
  await win.evaluate(() => { const s = window.__archdiscScene; let m = null; s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) m = o; }); if (m) window.__studioSelectMesh(m); });
  await win.waitForTimeout(200);

  const before = await win.evaluate(() => { const m = window.__studioSelectedMesh(); m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; return { size: [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z] }; });

  await win.locator('[data-studio-ribbon-action="quad-remesh"]').click();
  await win.waitForTimeout(2000);

  const r = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const quads = m.userData.archdiscQuads || [];
    const allFour = quads.length > 0 && quads.every((q) => q.length === 4);
    const triCount = m.geometry.index ? m.geometry.index.count / 3 : 0;
    m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox;
    return { quads: quads.length, allFour, triCount, meta: m.userData.archdiscStudioQuadRemesh, size: [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z] };
  });

  expect(r.quads, 'produced quad faces').toBeGreaterThan(50);
  expect(r.allFour, 'every recorded face is a genuine 4-sided quad').toBe(true);
  expect(r.triCount, 'tri count = 2 per quad (quad-faced topology)').toBe(r.quads * 2);
  expect(r.meta && r.meta.resolution, 'quad-remesh metadata recorded').toBeGreaterThanOrEqual(16);
  for (let a = 0; a < 3; a++) { if (before.size[a] < 1e-4) continue; expect(Math.abs(r.size[a] - before.size[a]) / before.size[a], `quad remesh keeps bbox axis ${a}`).toBeLessThan(0.3); }

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(32, 22, 1.2); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-quad-remeshed.png') });

  // eslint-disable-next-line no-console
  console.log(`  quad remesh: ${r.quads} quads (all 4-sided=${r.allFour}), ${r.triCount} tris, res ${r.meta && r.meta.resolution}`);

  await app.close();
});
