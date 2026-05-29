import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — RAY-TRACED AO BAKE (headed Electron).
 *
 * Upgrades the old fake "AO" (a normal-vs-centre concavity proxy that ignored
 * all other geometry) to a real hemisphere ray-traced bake (Unreal Lightmass /
 * Unity Progressive Lightmapper / Blender bake AO). The discriminating test:
 * two TOUCHING boxes — baking one must darken the face pressed against the
 * other (inter-object occlusion), producing a large AO range. An isolated
 * convex box would bake ~uniformly (range ~0), so a big range proves real
 * occlusion-by-other-geometry, not a curvature trick.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-ao-bake');

test('Studio — ray-traced AO bake darkens an inter-object contact face', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 25 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioBakeAO === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // two cubes, placed face-to-face touching; select the first
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(160);
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(220);
  const setup = await win.evaluate(() => {
    const s = window.__archdiscScene; const arr = [];
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') arr.push(o); });
    const a = arr[arr.length - 2], b = arr[arr.length - 1];
    a.geometry.computeBoundingBox(); const bb = a.geometry.boundingBox; const w = bb.max.x - bb.min.x;
    a.position.set(0, 0, 0); b.position.set(w * 1.04, 0, 0); // a tiny gap off a's +X face
    a.updateMatrixWorld(true); b.updateMatrixWorld(true);
    window.__studioSelectMesh(a);
    return { w, count: arr.length };
  });
  expect(setup.count, 'two cubes present').toBeGreaterThanOrEqual(2);

  // ── bake AO on the first box (real ribbon button) + read the result ──
  await win.locator('[data-studio-ribbon-action="bake-ao"]').click();
  await win.waitForTimeout(300);
  const ao = await win.evaluate(() => window.__studioBakeAO());
  expect(ao, 'AO bake returned stats').not.toBeNull();
  expect(ao.min, 'the contact face is occluded (darkened)').toBeLessThan(0.75);
  expect(ao.max, 'the exposed faces stay bright').toBeGreaterThan(0.85);
  expect(ao.max - ao.min, 'AO range = real inter-object occlusion (an isolated convex box bakes ~flat)').toBeGreaterThan(0.15);

  // the +X face (toward the other box) is darker than the -X face
  const faces = await win.evaluate(() => {
    const m = window.__studioSelectedMesh(); const g = m.geometry; const p = g.attributes.position, c = g.attributes.color;
    let plusXmin = 1, minusXmax = 0; const bb = g.boundingBox; const hi = bb.max.x - 1e-4, lo = bb.min.x + 1e-4;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i); const v = c.getX(i); if (x >= hi) plusXmin = Math.min(plusXmin, v); if (x <= lo) minusXmax = Math.max(minusXmax, v); }
    return { plusXmin, minusXmax };
  });
  expect(faces.plusXmin, 'occluded +X (contact) face is darker than the exposed -X face').toBeLessThan(faces.minusXmax - 0.1);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(28, 16, 1.25); });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-ao-baked-boxes.png') });

  // eslint-disable-next-line no-console
  console.log(`  AO bake: min=${ao.min.toFixed(2)} max=${ao.max.toFixed(2)} mean=${ao.mean.toFixed(2)} range=${(ao.max - ao.min).toFixed(2)} rays=${ao.rays}; +Xface=${faces.plusXmin.toFixed(2)} vs -Xface=${faces.minusXmax.toFixed(2)}`);

  await app.close();
});
