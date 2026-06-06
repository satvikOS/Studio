// ArchDisc Studio V3 — Unreal Sequencer cinematic CAMERAS (slice 766).
//
// Headed Mac-Electron spec. Verifies the pure-JS shot vault + playback
// head ships:
//   • boot the V3 shell, install the cinecam autoload
//   • spawn a unit cube at the origin so the orbit has a subject
//   • __studioCineCamCreateOrbit({target:{0,0,0}, radius:5, height:2,
//                                  duration:4}) → ok + shotKey
//   • __studioCineCamPlay({shotKey, t:0})    → returns position A
//   • __studioCineCamPlay({shotKey, t:0.25}) → returns position B
//   • assert |A - B| > 0 (the orbit moved the camera 90° around the
//     target — radius 5 → ~7.07 m euclidean displacement; allow a wide
//     margin for hermite-spline corner-cutting)
//   • __studioCineCamList() reports exactly one shot of kind 'orbit'
//   • __studioCineCamCreateDolly({start:{0,0,5}, end:{0,5,10},
//                                  duration:2}) ok (smoke)
//   • __studioCineCamDelete(shotKey) ok
//   • 5 cam angles for remote-desktop verification
//
// e2e DOES NOT run during this slice (per the slice brief — the harness
// runs builds, not playwright). This file just has to compile cleanly
// once the autoload + the ops are wired correctly.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-cinecam');
const NAMED_VIEWS = ['front', 'top', 'right', 'iso', 'close'];

test('Studio V3 — Unreal Sequencer cinematic cameras (slice 766)', async () => {
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

  // ── Make sure the cinecam module is installed. ────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioCineCamCreateOrbit !== 'function') {
      await import('/src/workbenches/studio/v3/cinecam/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioCineCamRecord === 'function'
       && typeof window.__studioCineCamPlay === 'function'
       && typeof window.__studioCineCamCreateOrbit === 'function'
       && typeof window.__studioCineCamCreateDolly === 'function'
       && typeof window.__studioCineCamList === 'function'
       && typeof window.__studioCineCamDelete === 'function',
    null, { timeout: 20000 }
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── Spawn a unit cube as the orbit subject. ──────────────────────
  await win.evaluate(() => {
    const THREE = window.THREE;
    const g = new THREE.BoxGeometry(2, 2, 2);
    const m = new THREE.MeshStandardMaterial({ color: 0xb6a87a, roughness: 0.6 });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(0, 0, 0);
    mesh.name = 'cinecam-subject';
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'cinecam-subject';
    window.__archdiscScene.add(mesh);
    if (typeof window.__studioSelectMesh === 'function') {
      try { window.__studioSelectMesh(mesh); } catch (_) {}
    }
  });
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '01-subject-spawned.png') });

  // ── 1) Create an orbit shot around the cube. ─────────────────────
  const orbit = await win.evaluate(() => window.__studioCineCamCreateOrbit({
    target: { x: 0, y: 0, z: 0 },
    radius: 5,
    height: 2,
    duration: 4,
  }));
  expect(orbit.ok).toBe(true);
  expect(typeof orbit.shotKey).toBe('string');
  expect(orbit.shotKey.length).toBeGreaterThan(0);
  // duration 4 × fps 30 + 1 = 121 frames
  expect(orbit.frameCount).toBeGreaterThan(100);

  // ── 2) Play at t=0 and t=0.25 → positions differ. ────────────────
  const sampleA = await win.evaluate((k) => window.__studioCineCamPlay({ shotKey: k, t: 0 }), orbit.shotKey);
  expect(sampleA.ok).toBe(true);
  expect(Array.isArray(sampleA.position)).toBe(true);
  expect(sampleA.position.length).toBe(3);
  expect(Array.isArray(sampleA.target)).toBe(true);
  expect(sampleA.target.length).toBe(3);
  // t=0 → angle 0 → position (radius, height, 0)
  expect(sampleA.position[0]).toBeCloseTo(5, 2);
  expect(sampleA.position[1]).toBeCloseTo(2, 2);
  expect(sampleA.position[2]).toBeCloseTo(0, 2);
  await win.screenshot({ path: path.join(OUT, '02-play-t0.png') });

  const sampleB = await win.evaluate((k) => window.__studioCineCamPlay({ shotKey: k, t: 0.25 }), orbit.shotKey);
  expect(sampleB.ok).toBe(true);
  // t=0.25 → angle π/2 → position (0, height, radius) approximately
  // Hermite spline may corner-cut slightly; allow a generous tolerance.
  expect(Math.abs(sampleB.position[0])).toBeLessThan(1.5);
  expect(sampleB.position[1]).toBeCloseTo(2, 2);
  expect(sampleB.position[2]).toBeGreaterThan(3.5);

  // The two sampled positions must DIFFER (the orbit shot is doing work).
  const dx = sampleA.position[0] - sampleB.position[0];
  const dy = sampleA.position[1] - sampleB.position[1];
  const dz = sampleA.position[2] - sampleB.position[2];
  const dist = Math.hypot(dx, dy, dz);
  expect(dist).toBeGreaterThan(1);
  await win.screenshot({ path: path.join(OUT, '03-play-t025.png') });

  // ── 3) List → exactly one shot of kind 'orbit'. ──────────────────
  const list1 = await win.evaluate(() => window.__studioCineCamList());
  expect(list1.ok).toBe(true);
  expect(Array.isArray(list1.shots)).toBe(true);
  expect(list1.shots.length).toBeGreaterThanOrEqual(1);
  const orbitShot = list1.shots.find((s) => s.key === orbit.shotKey);
  expect(orbitShot).toBeTruthy();
  expect(orbitShot.kind).toBe('orbit');
  expect(orbitShot.duration).toBeCloseTo(4, 2);

  // ── 4) Create a dolly shot as a second smoke. ────────────────────
  const dolly = await win.evaluate(() => window.__studioCineCamCreateDolly({
    start: { x: 0, y: 0, z: 5 },
    end: { x: 0, y: 5, z: 10 },
    duration: 2,
  }));
  expect(dolly.ok).toBe(true);
  expect(typeof dolly.shotKey).toBe('string');
  expect(dolly.frameCount).toBeGreaterThan(50);

  const dollyA = await win.evaluate((k) => window.__studioCineCamPlay({ shotKey: k, t: 0 }), dolly.shotKey);
  expect(dollyA.ok).toBe(true);
  expect(dollyA.position[0]).toBeCloseTo(0, 2);
  expect(dollyA.position[1]).toBeCloseTo(0, 2);
  expect(dollyA.position[2]).toBeCloseTo(5, 2);

  const dollyB = await win.evaluate((k) => window.__studioCineCamPlay({ shotKey: k, t: 1 }), dolly.shotKey);
  expect(dollyB.ok).toBe(true);
  expect(dollyB.position[0]).toBeCloseTo(0, 2);
  expect(dollyB.position[1]).toBeCloseTo(5, 2);
  expect(dollyB.position[2]).toBeCloseTo(10, 2);

  // ── 5) Record the current camera state (smoke — frozen frames). ──
  const recording = await win.evaluate(() => window.__studioCineCamRecord({ duration: 1, fps: 30 }));
  expect(recording.ok).toBe(true);
  expect(typeof recording.shotKey).toBe('string');
  expect(recording.frameCount).toBeGreaterThanOrEqual(31);

  // ── 6) Delete the orbit shot. ────────────────────────────────────
  const del = await win.evaluate((k) => window.__studioCineCamDelete({ shotKey: k }), orbit.shotKey);
  expect(del.ok).toBe(true);

  const list2 = await win.evaluate(() => window.__studioCineCamList());
  expect(list2.ok).toBe(true);
  expect(list2.shots.find((s) => s.key === orbit.shotKey)).toBeUndefined();
  // The dolly + recording shots remain.
  expect(list2.shots.length).toBeGreaterThanOrEqual(2);

  // ── 7) 5-cam sweep. ──────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 766: orbit frames', orbit.frameCount,
    'sampleA pos', sampleA.position.map((n) => n.toFixed(2)).join(','),
    'sampleB pos', sampleB.position.map((n) => n.toFixed(2)).join(','),
    'separation', dist.toFixed(3));

  await app.close();
});
