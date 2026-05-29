import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — LOFT / SWEEP (headed Electron).
 *
 * Closes the "no loft/sweep" gap (3ds Max Loft with a single shape / Rhino
 * Sweep1 / Blender curve bevel). Sweeps an arbitrary polygonal PROFILE along a
 * PATH curve via Frenet frames. Verifies: the ribbon builds a square-section
 * helix (vertices == rings*profilePoints, bbox spans the helix), and the engine
 * sweeps a star profile along a CLOSED ring path (closed -> rings == stations).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-loft-sweep');

test('Studio — loft/sweep a profile along a path curve', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 25 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioSweepLoft === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // ── 1) ribbon: sweep a SQUARE profile along a HELIX path ──
  await win.locator('[data-studio-primitive="sweep-loft"]').click();
  await win.waitForTimeout(400);
  const helix = await win.evaluate(() => {
    const s = window.__archdiscScene; let m = null;
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sweep-loft') m = o; });
    if (!m) return null;
    m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox;
    return { v: m.geometry.attributes.position.count, sweep: m.userData.archdiscSweep, dx: bb.max.x - bb.min.x, dy: bb.max.y - bb.min.y, dz: bb.max.z - bb.min.z };
  });
  expect(helix, 'a sweep-loft primitive entered the scene').not.toBeNull();
  expect(helix.sweep.profile, 'square profile').toBe('square');
  expect(helix.sweep.profile === 'square' ? 4 : 0, 'square has 4 profile points').toBe(helix.sweep.profilePoints);
  expect(helix.sweep.path, 'helix path').toBe('helix');
  expect(helix.v, 'vertex count == rings * profilePoints').toBe(helix.sweep.rings * helix.sweep.profilePoints);
  // bbox spans the helix: height ~0.8, diameter ~0.6 (+ profile)
  expect(helix.dy, 'swept solid spans the helix height').toBeGreaterThan(0.7);
  expect(Math.min(helix.dx, helix.dz), 'swept solid spans the helix diameter').toBeGreaterThan(0.5);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(20, 10, 1.3); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-square-helix-sweep.png') });

  // ── 2) engine via hook: STAR profile along a CLOSED RING path ──
  const ring = await win.evaluate(() => window.__studioSweepLoft({ profile: 'star', path: 'ring', profileSize: 0.06, radius: 0.4, stations: 120 }));
  expect(ring.error, 'star/ring sweep ran').toBeFalsy();
  expect(ring.profilePoints, 'star profile has 10 points').toBe(10);
  expect(ring.path, 'ring path').toBe('ring');
  // closed path -> rings == stations (wraps), so vertices == stations*10
  expect(ring.rings, 'closed ring has stations rings (no +1 cap)').toBe(120);
  expect(ring.vertices, 'star-ring vertex count').toBe(120 * 10);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(24, 16, 1.25); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '02-star-ring-sweep.png') });

  // eslint-disable-next-line no-console
  console.log(`  loft/sweep: square-helix v=${helix.v} (${helix.sweep.rings}x${helix.sweep.profilePoints}) bbox ${helix.dx.toFixed(2)}/${helix.dy.toFixed(2)}/${helix.dz.toFixed(2)}; star-ring v=${ring.vertices} (${ring.rings}x${ring.profilePoints})`);

  await app.close();
});
