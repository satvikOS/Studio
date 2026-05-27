import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 65 — Loop subdivision (smooth scheme).
 *
 * Charles Loop's classical smooth subdivision: every triangle splits
 * into 4, edge midpoints use 3/8-1/8 weighted average of 4 surrounding
 * vertices, and existing vertices pull toward their one-ring centroid
 * via Loop's beta weight.
 *
 * The result smooths the silhouette of low-poly meshes (icosa, cube)
 * while still increasing vertex count 4×. Distinct from the existing
 * midpoint Subdivide — that one only inserts midpoints; this one
 * also REPOSITIONS them and the existing vertices.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-loop-subdivision');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function meshStats(win, kind) {
  return await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (!m) return null;
    // Bounding-sphere radius is a proxy for "silhouette tightness" —
    // Loop smoothing pulls verts inward toward the centroid, so the
    // bounding sphere radius decreases slightly.
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    const tris = m.geometry.index
      ? m.geometry.index.count / 3
      : m.geometry.attributes.position.count / 3;
    return {
      verts: m.geometry.attributes.position.count,
      tris,
      bsRadius: m.geometry.boundingSphere.radius,
      loopApplied: m.userData.archdiscStudioLoopSubdivided || 0,
    };
  }, kind);
}

test('Studio Loop Subdivision — smooth scheme with weighted edge + vertex updates', async () => {
  test.setTimeout(120000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 200,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Icosahedron — 12 verts, 20 tris baseline.
  await win.locator('[data-studio-primitive="icosahedron"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'icosahedron');
  await win.waitForTimeout(300);

  // Need Sculpting tab for Subdivision section visibility.
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="sculpting"]').click();
  await win.waitForTimeout(300);

  const baseline = await meshStats(win, 'icosahedron');
  expect(baseline).not.toBeNull();
  await win.screenshot({ path: path.join(OUT, '00-baseline-icosahedron.png'), fullPage: false });

  // Run Loop subdivision once.
  await win.locator('[data-studio-action="loop-subdivide-selected"]').click();
  await win.waitForTimeout(400);

  const after1 = await meshStats(win, 'icosahedron');
  expect(after1.loopApplied).toBe(1);
  // Topology: 4× triangle count.
  expect(after1.tris).toBe(baseline.tris * 4);
  // Verts: original 12 + 30 edges = 42 (Euler relation V-E+F=2 -> E=30 for icosa).
  // After subdivision: 12 + 30 = 42 verts (V'=V+E)
  expect(after1.verts).toBe(42);
  // Bounding sphere radius SHRINKS slightly (Loop smoothing pulls
  // existing vertices toward the centroid).
  expect(after1.bsRadius).toBeLessThan(baseline.bsRadius);
  await win.screenshot({ path: path.join(OUT, '01-loop-once.png'), fullPage: false });

  // Second pass — even smoother. 42 verts + edges of subdivided icosa.
  // After 2nd Loop: tris = 20*16 = 320; verts grow further.
  await win.locator('[data-studio-action="loop-subdivide-selected"]').click();
  await win.waitForTimeout(500);
  const after2 = await meshStats(win, 'icosahedron');
  expect(after2.loopApplied).toBe(2);
  expect(after2.tris).toBe(baseline.tris * 16);
  expect(after2.verts).toBeGreaterThan(after1.verts);
  expect(after2.bsRadius).toBeLessThan(after1.bsRadius);
  await win.screenshot({ path: path.join(OUT, '02-loop-twice.png'), fullPage: false });

  // ---- 4-angle showcase comparing baseline vs heavily-Looped sphere ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 18, 1), az);
    await win.waitForTimeout(250);
    await win.screenshot({ path: path.join(OUT, `03-loop-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  loop subdivision: icosa baseline ${baseline.verts}v/${baseline.tris}t r=${baseline.bsRadius.toFixed(5)} -> loop1 ${after1.verts}v/${after1.tris}t r=${after1.bsRadius.toFixed(5)} (smoothed silhouette) -> loop2 ${after2.verts}v/${after2.tris}t r=${after2.bsRadius.toFixed(5)}`);

  await app.close();
});
