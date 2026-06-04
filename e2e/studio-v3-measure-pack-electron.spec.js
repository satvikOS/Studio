import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-measure-pack');

test('Studio V3 — measure: distance/angle/volume/area/pivot/stats (slice 643)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // 1: distance 3-4-5 right triangle
  const d = await win.evaluate(() => window.__studioMeasureDistance([0,0,0], [3,4,0]));
  expect(d.ok).toBe(true);
  expect(d.distance).toBeCloseTo(5, 6);
  await win.screenshot({ path: path.join(OUT, '01-distance.png') });

  // 2: angle 90°
  const a = await win.evaluate(() => window.__studioMeasureAngle([1,0,0], [0,0,0], [0,1,0]));
  expect(a.ok).toBe(true);
  expect(a.degrees).toBeCloseTo(90, 2);
  await win.screenshot({ path: path.join(OUT, '02-angle.png') });

  // Create a cube to measure
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const cubeUuid = await win.evaluate(() => window.__studioSelectedMesh().uuid);

  // 3: bounding box volume
  const v = await win.evaluate(() => window.__studioMeasureBoundingBoxVolume());
  expect(v.ok).toBe(true);
  expect(v.volume).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '03-volume.png') });

  // 4: surface area
  const sa = await win.evaluate(() => window.__studioMeasureSurfaceArea());
  expect(sa.ok).toBe(true);
  expect(sa.area).toBeGreaterThan(0);
  expect(sa.triangles).toBe(12); // cube = 6 faces × 2 tris
  await win.screenshot({ path: path.join(OUT, '04-area.png') });

  // 5: pivot (cube centred at origin so pivot ≈ position)
  const p = await win.evaluate(() => window.__studioMeasurePivot());
  expect(p.ok).toBe(true);
  expect(p.center.length).toBe(3);
  await win.screenshot({ path: path.join(OUT, '05-pivot.png') });

  // 6: stats
  const st = await win.evaluate(() => window.__studioMeasureGetStats());
  expect(st.ok).toBe(true);
  expect(st.vertices).toBeGreaterThan(0);
  expect(st.triangles).toBe(12);
  expect(st.volume).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '06-stats.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 643: 6 measure features — d=5, θ=90°, V=', v.volume.toFixed(3), 'A=', sa.area.toFixed(3));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
