import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 58 — Smooth / Flat shading toggle.
 *
 * Standard modelling-mode op. Rebuilds the selected mesh's geometry
 * so vertex normals are either averaged across adjacent faces
 * (smooth) or duplicated per-face (flat / faceted look).
 *
 * Spec spawns a low-poly cube and an icosahedron, runs Smooth then
 * Flat then Smooth, checks vertex counts + normal averages reflect
 * the expected shading mode.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-shading-toggle');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function geomStats(win, kind) {
  return await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (!m) return null;
    const pos = m.geometry.attributes.position;
    const nrm = m.geometry.attributes.normal;
    // Count UNIQUE normal vectors — a flat-shaded mesh has one normal
    // per face (and many duplicates), while a smooth mesh has many
    // distinct normals (one per vertex with averaged direction).
    const seen = new Set();
    for (let i = 0; i < nrm.count; i++) {
      const x = Math.round(nrm.getX(i) * 1000) / 1000;
      const y = Math.round(nrm.getY(i) * 1000) / 1000;
      const z = Math.round(nrm.getZ(i) * 1000) / 1000;
      seen.add(`${x}_${y}_${z}`);
    }
    return {
      verts: pos.count,
      indexed: !!m.geometry.index,
      uniqueNormals: seen.size,
      shading: m.userData.archdiscStudioShading || 'default',
    };
  }, kind);
}

test('Studio Shading — Smooth / Flat toggle rebuilds normals appropriately', async () => {
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

  // Stage: icosahedron (20 faces, 12 unique vertex positions, originally
  // ships with each face's vertices duplicated -> 60 vert/index pairs).
  await win.locator('[data-studio-primitive="icosahedron"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'icosahedron');
  await win.waitForTimeout(300);

  const baseline = await geomStats(win, 'icosahedron');
  expect(baseline).not.toBeNull();
  await win.screenshot({ path: path.join(OUT, '00-baseline.png'), fullPage: false });

  // ---- Smooth shading -> few unique normals because each unique
  //      vertex position averages neighbour faces -> 12 normals on icosa.
  await win.locator('[data-studio-action="shading-smooth"]').click();
  await win.waitForTimeout(400);
  const smooth = await geomStats(win, 'icosahedron');
  expect(smooth.shading).toBe('smooth');
  expect(smooth.indexed).toBe(true);
  expect(smooth.verts).toBe(12); // icosahedron's 12 corners after dedupe
  expect(smooth.uniqueNormals).toBe(12); // each vertex has its own averaged normal
  await win.screenshot({ path: path.join(OUT, '01-smooth.png'), fullPage: false });

  // ---- Flat shading -> 20 unique face normals (icosahedron has 20 faces).
  //      verts = 60 (3 corners * 20 faces), each face's three corners share
  //      the same per-face normal.
  await win.locator('[data-studio-action="shading-flat"]').click();
  await win.waitForTimeout(400);
  const flat = await geomStats(win, 'icosahedron');
  expect(flat.shading).toBe('flat');
  expect(flat.indexed).toBe(false);
  expect(flat.verts).toBe(60); // 20 faces * 3 corners
  expect(flat.uniqueNormals).toBe(20); // one per face
  await win.screenshot({ path: path.join(OUT, '02-flat.png'), fullPage: false });

  // ---- Smooth again -> back to indexed, ~12 verts ----
  await win.locator('[data-studio-action="shading-smooth"]').click();
  await win.waitForTimeout(400);
  const smoothAgain = await geomStats(win, 'icosahedron');
  expect(smoothAgain.shading).toBe('smooth');
  expect(smoothAgain.indexed).toBe(true);
  expect(smoothAgain.verts).toBe(12);
  expect(smoothAgain.uniqueNormals).toBe(12);

  // ---- 4-angle showcase comparing smooth vs flat side-by-side ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 18, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `03-smooth-az${az}.png`), fullPage: false });
  }

  // Switch to flat for comparison angle.
  await win.locator('[data-studio-action="shading-flat"]').click();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '04-flat-comparison.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  shading: icosa baseline ${baseline.verts}v / ${baseline.uniqueNormals}n -> smooth 12v/12n indexed -> flat 60v/20n non-indexed`);

  await app.close();
});
