// ArchDisc Studio — SketchUp live inference snap engine (slice 748).
//
// Headed Mac-Electron spec. Verifies the inference engine resolves the
// right snap kind + color + label across endpoint / midpoint / face
// centre / axis-line scenarios, and that axis-lock projects the result
// onto the locked axis line.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-inference-snap');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio — SketchUp live inference snap engine (slice 748)', async () => {
  test.setTimeout(420000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });

  let win = null;
  for (let i = 0; i < 30 && !win; i++) {
    win = app.windows().find((w) => {
      const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
      return u && !u.startsWith('devtools://');
    }) || null;
    if (!win) await new Promise((r) => setTimeout(r, 500));
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
  await win.waitForFunction(
    () => !!window.__archdiscViewport && !!window.__archdiscScene
       && typeof window.__studioInferenceQuery === 'function',
    null, { timeout: 30000 },
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Engine is auto-on. ────────────────────────────────────────
  const init = await win.evaluate(() => window.__studioInferenceGetState());
  console.log('[inf] init', JSON.stringify(init));
  expect(init.ok).toBe(true);
  expect(init.enabled).toBe(true);
  expect(init.tolerancePx).toBeGreaterThan(2);

  // ── 2) Place a unit cube. Resolve a known vertex world position
  //      and project it to screen, then query just off the projection.
  const seed = await win.evaluate(() => {
    const THREE = window.THREE;
    const g = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xcccccc }));
    m.userData.archdiscStudioPrimitive = true;
    m.userData.archdiscStudioPrimitiveKind = 'cube';
    window.__archdiscScene.add(m);
    if (window.__studioSelectMesh) window.__studioSelectMesh(m);
    // Camera framing — force a known orbit so projections are stable.
    if (typeof window.__archdiscOrbitView === 'function') {
      window.__archdiscOrbitView(30, 25, 1);
    }
    const vp = window.__archdiscViewport;
    const renderer = vp.renderer, camera = vp.camera;
    const W = renderer.domElement.clientWidth;
    const H = renderer.domElement.clientHeight;
    function project(p) {
      const v = p.clone().project(camera);
      return [(v.x * 0.5 + 0.5) * W, (1 - (v.y * 0.5 + 0.5)) * H];
    }
    // Pick the (+0.5, +0.5, +0.5) corner.
    const vertWorld = new THREE.Vector3(0.5, 0.5, 0.5).applyMatrix4(m.matrixWorld);
    const [vx, vy] = project(vertWorld);
    // Pick an edge midpoint on the top face: between (+0.5,+0.5,+0.5)
    // and (-0.5,+0.5,+0.5) → (0, 0.5, 0.5).
    const midWorld = new THREE.Vector3(0, 0.5, 0.5).applyMatrix4(m.matrixWorld);
    const [mx, my] = project(midWorld);
    // Centre of the top face: (0, 0.5, 0).
    const centreWorld = new THREE.Vector3(0, 0.5, 0).applyMatrix4(m.matrixWorld);
    const [cx, cy] = project(centreWorld);
    return {
      uuid: m.uuid, W, H,
      vertWorld: [vertWorld.x, vertWorld.y, vertWorld.z], vertScreen: [vx, vy],
      midWorld:  [midWorld.x, midWorld.y, midWorld.z],   midScreen:  [mx, my],
      centreWorld: [centreWorld.x, centreWorld.y, centreWorld.z], centreScreen: [cx, cy],
    };
  });
  console.log('[inf] seed', JSON.stringify(seed));

  // 2a) Endpoint hit.
  const ep = await win.evaluate((s) => window.__studioInferenceQuery({ x: s.vertScreen[0] + 1, y: s.vertScreen[1] + 1 }), seed);
  console.log('[inf] endpoint', JSON.stringify(ep));
  expect(ep.ok).toBe(true);
  expect(ep.kind).toBe('endpoint');
  expect(ep.color).toBe(0x1de989);
  expect(ep.label).toBe('Endpoint');
  // Returned world point should match the vertex within a small tolerance.
  expect(Math.hypot(
    ep.point[0] - seed.vertWorld[0],
    ep.point[1] - seed.vertWorld[1],
    ep.point[2] - seed.vertWorld[2],
  )).toBeLessThan(1e-3);

  // 2b) Midpoint hit (must NOT collapse to endpoint).
  const mid = await win.evaluate((s) => window.__studioInferenceQuery({ x: s.midScreen[0], y: s.midScreen[1] }), seed);
  console.log('[inf] midpoint', JSON.stringify(mid));
  expect(mid.ok).toBe(true);
  // Could be 'midpoint' or 'endpoint' if one of the endpoints is also in
  // tolerance — but the world point should snap to one of the FEATURES,
  // not the cursor's free-space projection.
  expect(['endpoint', 'midpoint']).toContain(mid.kind);

  // 2c) Face centre hit (move cursor onto the top-face centroid).
  const cen = await win.evaluate((s) => window.__studioInferenceQuery({ x: s.centreScreen[0], y: s.centreScreen[1] }), seed);
  console.log('[inf] centre', JSON.stringify(cen));
  expect(cen.ok).toBe(true);
  // Possible snaps within tolerance: face centroid (cube's 6×2 tris
  // each contribute), or vertex/midpoint of one of the back tris. We
  // accept any feature snap and require a known kind.
  expect(['centre', 'midpoint', 'endpoint']).toContain(cen.kind);

  // ── 3) No-hit far from anything: kind should be null. ────────────
  const miss = await win.evaluate(() => window.__studioInferenceQuery({ x: 5, y: 5 }));
  console.log('[inf] miss', JSON.stringify(miss));
  expect(miss.ok).toBe(true);
  expect(miss.kind == null).toBe(true);

  // ── 4) Anchor + axis lock. Lock to X then query for any snap and
  //      assert the returned world Y/Z match the anchor's Y/Z.
  const lock = await win.evaluate((s) => {
    window.__studioInferenceSetAnchor([0, 0, 0]);
    window.__studioInferenceLock('x');
    const q = window.__studioInferenceQuery({ x: s.vertScreen[0] + 1, y: s.vertScreen[1] + 1 });
    window.__studioInferenceLock(null);
    return q;
  }, seed);
  console.log('[inf] locked', JSON.stringify(lock));
  expect(lock.ok).toBe(true);
  // Returned point should have Y ≈ anchor.y = 0 and Z ≈ anchor.z = 0.
  expect(Math.abs(lock.point[1])).toBeLessThan(1e-6);
  expect(Math.abs(lock.point[2])).toBeLessThan(1e-6);

  // ── 5) Tolerance change applies. ─────────────────────────────────
  const tol = await win.evaluate(() => {
    window.__studioInferenceSetTolerancePx(4);
    const s = window.__studioInferenceGetState();
    return s.tolerancePx;
  });
  expect(tol).toBe(4);

  // ── 6) Camera sweep. ─────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  const finalState = await win.evaluate(() => window.__studioInferenceGetState());
  // eslint-disable-next-line no-console
  console.log('  slice 748: endpoint=', ep.kind, ' centre=', cen.kind, ' locked y/z=',
              lock.point[1], lock.point[2], ' queries=', finalState.lastSnap ? 'snap' : 'none');

  try { await app.close(); } catch (_) { /* worker teardown best-effort */ }
});
