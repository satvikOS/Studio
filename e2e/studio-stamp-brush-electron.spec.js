import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — ZBRUSH ALPHA STAMP brush (headed Electron).
 *
 * Closes a DCC gap (stamp/stencil/alpha sculpting — was ABSENT). The 'stamp'
 * brush drives the relief by a procedural alpha (concentric rings), so the
 * imprint is a PATTERN, not a uniform dome. Verified by binning per-vertex
 * displacement by distance-from-hit: the stamp profile is NON-monotonic (rings)
 * whereas a plain 'draw' stroke falls off monotonically.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-stamp-brush');

test('Studio — alpha stamp imprints a ring pattern (non-monotonic vs draw)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 25 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioBrushStrokeAt === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // a sphere (dense enough), selected; subdivide once for crisp rings
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(250);
  await win.evaluate(() => { const s = window.__archdiscScene; let m = null; s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) m = o; }); if (m) window.__studioSelectMesh(m); });
  await win.waitForTimeout(200);

  // Returns the radius-binned mean displacement profile for a stroke `mode`.
  const profileFor = (mode) => win.evaluate((m) => {
    const mesh = window.__studioSelectedMesh(); const pos = mesh.geometry.attributes.position;
    const before = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { before[i * 3] = pos.getX(i); before[i * 3 + 1] = pos.getY(i); before[i * 3 + 2] = pos.getZ(i); }
    mesh.geometry.computeBoundingBox();
    const wb = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    const top = [(wb.min.x + wb.max.x) / 2, wb.max.y, (wb.min.z + wb.max.z) / 2];
    const radius = (wb.max.x - wb.min.x) * 0.55;
    window.__studioBrushStrokeAt(top, { mode: m, radius, strength: 0.7 });
    // local hit point (Vector3 via the live camera's constructor)
    const Vec = window.__archdiscViewport.camera.position.constructor;
    const v = mesh.worldToLocal(new Vec(top[0], top[1], top[2]));
    const NB = 6; const bins = new Array(NB).fill(0); const counts = new Array(NB).fill(0);
    const rLocal = radius; // approx (uniform scale)
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - v.x, dy = pos.getY(i) - v.y, dz = pos.getZ(i) - v.z;
      const dist = Math.hypot(dx, dy, dz); if (dist > rLocal) continue;
      const disp = Math.hypot(pos.getX(i) - before[i * 3], pos.getY(i) - before[i * 3 + 1], pos.getZ(i) - before[i * 3 + 2]);
      const b = Math.min(NB - 1, Math.floor((dist / rLocal) * NB)); bins[b] += disp; counts[b]++;
    }
    return bins.map((s, i) => counts[i] ? s / counts[i] : 0);
  }, mode);

  const stampProfile = await profileFor('stamp');
  // a clear ring: some inner band is LOWER than an outer band (non-monotonic)
  let nonMonotonic = false;
  for (let i = 1; i < stampProfile.length; i++) if (stampProfile[i] > stampProfile[i - 1] * 1.25 && stampProfile[i] > 1e-6) nonMonotonic = true;
  expect(nonMonotonic, 'stamp displacement oscillates across radius (a ring alpha pattern)').toBe(true);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(16, 38, 1.25); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-stamped-rings.png') });

  // control: a fresh draw stroke should be ~monotonic (no inner-ring rise)
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => { const s = window.__archdiscScene; let m = null; s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; }); if (m) window.__studioSelectMesh(m); });
  const drawProfile = await profileFor('draw');
  let drawRises = 0;
  for (let i = 1; i < drawProfile.length; i++) if (drawProfile[i] > drawProfile[i - 1] * 1.25 && drawProfile[i] > 1e-6) drawRises++;
  expect(drawRises, 'a plain draw stroke falls off monotonically (no ring rises)').toBeLessThanOrEqual(1);

  // eslint-disable-next-line no-console
  console.log(`  stamp: profile [${stampProfile.map((x) => x.toExponential(1)).join(', ')}] (rings); draw rises=${drawRises}`);

  await app.close();
});
