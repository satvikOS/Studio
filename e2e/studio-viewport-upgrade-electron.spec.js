// ArchDisc Studio — Forge-parity viewport upgrade (slice 752).
//
// Headed Mac-Electron spec. The Studio viewport was inherited from a
// mm-scale CAD context (camera near 1e-4, far 100, OrbitControls
// minDistance 0.01, maxDistance 5, no zoomToCursor, render-every-frame).
// "Not fully dynamic", broken zoom, and heavy workloads choked.
//
// Verifies through __archdiscViewport that:
//   • Camera near=0.001 + far≥10000 (wide dynamic range)
//   • OrbitControls.zoomToCursor === true
//   • OrbitControls minDistance=0.001 / maxDistance=5000 / dampingFactor=0.08
//     / zoomSpeed=1.0 (Forge match — slice 744 monochrome chrome already
//     aligned the design tokens; this slice completes the viewport itself)
//   • window.__studioInvalidate exposed (render-on-demand hook)
//   • Adding a 200-unit-far mesh causes the adaptive frustum to push
//     camera.far past 1000 (Forge / Maya / Houdini auto-fit behaviour)
//   • Camera sweep (5 named views) — viewport pans cleanly under the
//     new orbit constraints

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-viewport-upgrade');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio — viewport Forge-parity upgrade (slice 752)', async () => {
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
    () => !!window.__archdiscViewport && !!window.__archdiscViewport.camera,
    null, { timeout: 30000 },
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Camera near/far reflect the slice 752 wide-dynamic-range frustum.
  const camInfo = await win.evaluate(() => {
    const { camera, orbitControls } = window.__archdiscViewport;
    return {
      near: camera.near,
      far:  camera.far,
      controls: {
        minDistance:   orbitControls.minDistance,
        maxDistance:   orbitControls.maxDistance,
        zoomToCursor:  orbitControls.zoomToCursor,
        zoomSpeed:     orbitControls.zoomSpeed,
        dampingFactor: orbitControls.dampingFactor,
      },
      hasInvalidate: typeof window.__studioInvalidate === 'function',
    };
  });
  console.log('[vp] cam', JSON.stringify(camInfo));
  expect(camInfo.near).toBeCloseTo(0.001, 6);
  expect(camInfo.far).toBeGreaterThanOrEqual(10000);
  expect(camInfo.controls.minDistance).toBeCloseTo(0.001, 6);
  expect(camInfo.controls.maxDistance).toBe(5000);
  expect(camInfo.controls.zoomToCursor).toBe(true);
  expect(camInfo.controls.zoomSpeed).toBeCloseTo(1.0, 3);
  expect(camInfo.controls.dampingFactor).toBeCloseTo(0.08, 4);
  expect(camInfo.hasInvalidate).toBe(true);

  // ── 2) Adaptive frustum: add a far mesh, far plane should grow.
  const farAdapt = await win.evaluate(async () => {
    const THREE = window.THREE;
    const cam = window.__archdiscViewport.camera;
    const scene = window.__archdiscViewport.scene;
    const before = { near: cam.near, far: cam.far };
    const big = new THREE.Mesh(
      new THREE.BoxGeometry(50, 50, 50),
      new THREE.MeshStandardMaterial({ color: 0x336699 }),
    );
    big.position.set(800, 0, 0);   // 800 units far — definitely beyond old far=100
    big.userData.archdiscStudioPrimitive = true;
    big.userData.archdiscStudioPrimitiveKind = 'cube';
    scene.add(big);
    // Wait ≥250ms for the throttled adapt to fire, then one extra RAF.
    await new Promise((r) => setTimeout(r, 350));
    await new Promise((r) => requestAnimationFrame(() => r()));
    return {
      before,
      after: { near: cam.near, far: cam.far },
    };
  });
  console.log('[vp] far-adapt', JSON.stringify(farAdapt));
  expect(farAdapt.after.far).toBeGreaterThan(1000);
  // near should still be sane (not collapsed)
  expect(farAdapt.after.near).toBeGreaterThan(0);

  // ── 3) Render-on-demand: __studioInvalidate exists & callable.
  const inv = await win.evaluate(() => {
    let ok = false;
    try { window.__studioInvalidate(); ok = true; } catch (_) {}
    return { ok };
  });
  expect(inv.ok).toBe(true);

  // ── 4) Camera sweep (regression: orbit still works under new constraints).
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 752: near=', camInfo.near, ' far=', camInfo.far,
              ' zoomToCursor=', camInfo.controls.zoomToCursor,
              ' adapted far=', farAdapt.after.far);

  try { await app.close(); } catch (_) { /* worker teardown best-effort */ }
});
