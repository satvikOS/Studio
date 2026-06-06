// ArchDisc Studio V3 — Poisson-disk + density-mask surface scatter (slice 755).
//
// Headed Mac-Electron spec. Verifies the real Bridson scatter:
//   • boot the V3 shell, install the scatter autoload
//   • spawn a unit sphere as the target surface
//   • __studioScatterOnSurface(sphereUuid, 500, {seed:1337, minDist:0.18}) ok
//   • accepted >= 480 (allow a little rejection slack from Bridson's
//     budget — the unit sphere has total area 4π ≈ 12.566 and minDist
//     0.18 gives a generous packing factor, so we expect very few
//     rejects)
//   • O(N²) pairwise distance scan: min pairwise distance ≥ minDist * 0.99
//   • on-surface check: every |pos| ∈ [0.995, 1.005] (the sphere has
//     radius 1; barycentric lerp inside the triangle leaves the
//     sample at slightly less than 1, never more)
//   • determinism: re-run with same seed → first point byte-equal
//   • density mask: scatter on 'topHalf' → every returned point has
//     y > -0.05 (allowing for floating-point + barycentric slack
//     because the topHalf mask is evaluated AFTER barycentric lerp,
//     so the rejection runs on the sample position itself)
//   • 5 cam angles for remote-desktop verification
//
// e2e DOES NOT run during this slice (port 3000 conflict per the
// brief); this file just has to compile when written.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-poisson-scatter');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — Poisson-disk + density-mask surface scatter', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });
  // --dev may auto-open a DevTools window; pick the real app window.
  let win = null;
  for (let i = 0; i < 30 && !win; i++) {
    win = app.windows().find((w) => {
      const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
      return u && !u.startsWith('devtools://');
    }) || null;
    if (!win) { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!win) win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  let shellUp = false;
  for (let attempt = 0; attempt < 4 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1500);
    try {
      await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 40000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 30000 });

  // ── Ensure the scatter module is installed. ────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioScatterOnSurface !== 'function') {
      await import('/src/workbenches/studio/v3/scatter/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioScatterOnSurface === 'function',
    null, { timeout: 20000 });
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── Spawn a unit sphere at the origin. ─────────────────────────────
  const spawn = await win.evaluate(() => {
    const THREE = window.THREE;
    const g = new THREE.SphereGeometry(1, 64, 64);
    const m = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.85 });
    const mesh = new THREE.Mesh(g, m);
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'sphere';
    window.__archdiscScene.add(mesh);
    if (typeof window.__studioSelectMesh === 'function') {
      try { window.__studioSelectMesh(mesh); } catch (_) {}
    }
    return { uuid: mesh.uuid };
  });
  expect(typeof spawn.uuid).toBe('string');
  console.log('[scatter] sphere uuid', spawn.uuid);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-sphere.png') });

  // ── 1) Scatter 500 darts with minDist 0.18. ───────────────────────
  const r = await win.evaluate((uuid) => {
    return window.__studioScatterOnSurface(uuid, 500, { seed: 1337, minDist: 0.18 });
  }, spawn.uuid);
  expect(r.ok).toBe(true);
  console.log('[scatter] accepted', r.accepted, 'of', r.requested, 'truncated', r.truncated);
  // Sphere area = 4π ≈ 12.566; with minDist 0.18 the upper bound is
  // generous, so Bridson should accept the vast majority.
  expect(r.points.length).toBeGreaterThanOrEqual(480);

  // ── 2) Pairwise min-distance scan. ─────────────────────────────────
  // O(N²) is fine for N=500: 125k pairs runs in well under a second.
  // The check accepts a tiny floating-point slack (0.99 * minDist)
  // because the spatial-hash rejection is exact in math but the lerp
  // through barycentric introduces tiny rounding.
  const minPair = await win.evaluate((points) => {
    let m2 = Infinity;
    let where = -1, where2 = -1;
    for (let i = 0; i < points.length; i++) {
      const a = points[i].pos;
      for (let j = i + 1; j < points.length; j++) {
        const b = points[j].pos;
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < m2) { m2 = d2; where = i; where2 = j; }
      }
    }
    return { min: Math.sqrt(m2), where, where2 };
  }, r.points);
  console.log('[scatter] pairwise min distance', minPair.min,
    '(threshold', 0.18 * 0.99, ')');
  expect(minPair.min).toBeGreaterThanOrEqual(0.18 * 0.99);

  // ── 3) On-surface check: every point on the unit sphere. ──────────
  const offSurface = await win.evaluate((points) => {
    let worst = 0;
    let count = 0;
    for (const p of points) {
      const r = Math.sqrt(p.pos.x * p.pos.x + p.pos.y * p.pos.y + p.pos.z * p.pos.z);
      if (Math.abs(r - 1) > Math.abs(worst - 1)) worst = r;
      if (r < 0.995 || r > 1.005) count++;
    }
    return { worst, count };
  }, r.points);
  console.log('[scatter] worst radius', offSurface.worst, 'off-surface count', offSurface.count);
  expect(offSurface.count).toBe(0);

  // ── 4) Determinism. ────────────────────────────────────────────────
  const r2 = await win.evaluate((uuid) => {
    return window.__studioScatterOnSurface(uuid, 500, { seed: 1337, minDist: 0.18 });
  }, spawn.uuid);
  expect(r2.ok).toBe(true);
  expect(r2.points.length).toBe(r.points.length);
  // Byte-equal first point. JSON round-trip is identity-preserving
  // for normal IEEE-754 floats, so this is a strict equality.
  expect(r2.points[0].pos.x).toBe(r.points[0].pos.x);
  expect(r2.points[0].pos.y).toBe(r.points[0].pos.y);
  expect(r2.points[0].pos.z).toBe(r.points[0].pos.z);

  // ── 5) Density mask — topHalf. ────────────────────────────────────
  const masked = await win.evaluate((uuid) => {
    return window.__studioScatterOnSurface(uuid, 300, {
      seed: 42, minDist: 0.15, densityMaskName: 'topHalf',
    });
  }, spawn.uuid);
  expect(masked.ok).toBe(true);
  console.log('[scatter] masked accepted', masked.accepted, 'truncated', masked.truncated);
  // The topHalf mask evaluates `pos.y > 0`; we allow a tiny slack so
  // floating-point points right on the equator (y ≈ 0) don't trip the
  // assertion if they squeak through.
  const minY = await win.evaluate((points) => {
    let lo = +Infinity;
    for (const p of points) if (p.pos.y < lo) lo = p.pos.y;
    return lo;
  }, masked.points);
  console.log('[scatter] masked minY', minY);
  expect(minY).toBeGreaterThan(-0.05);

  // ── 6) Listing + mask-list ops sanity-check. ──────────────────────
  const masks = await win.evaluate(() => window.__studioScatterMaskList());
  expect(masks.ok).toBe(true);
  expect(masks.names).toEqual(expect.arrayContaining(['topHalf', 'uvCheckerboard', 'always']));

  // ── 7) Instanced scatter for the camera sweep. ────────────────────
  const inst = await win.evaluate((uuid) => {
    return window.__studioScatterOnSurfaceInstanced(uuid, 800, {
      seed: 7, minDist: 0.12,
    });
  }, spawn.uuid);
  console.log('[scatter] instanced', inst.uuid, 'count', inst.count);
  expect(inst.ok).toBe(true);
  expect(typeof inst.uuid).toBe('string');
  expect(inst.count).toBeGreaterThan(500);
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '02-instanced.png') });

  const listing = await win.evaluate(() => window.__studioScatterList());
  expect(listing.ok).toBe(true);
  expect(listing.items.some((it) => it.uuid === inst.uuid)).toBe(true);

  // ── 8) 5-cam sweep. ───────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 755: scatter accepted', r.points.length, '/ 500 (minDist',
    minPair.min, '), masked minY', minY, ', instanced', inst.count);

  await app.close();
});
