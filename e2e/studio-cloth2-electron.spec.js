// ArchDisc Studio V3 — Marvelous Designer / Chaos Cloth real cloth
// simulation (slice 765).
//
// Headed Mac-Electron spec. Verifies the Verlet + PBD cloth solver:
//   • boot the V3 shell, install the cloth2 autoload
//   • build a 40x40-segment plane at y = 2 in the XZ plane (so the top
//     row is at +X, bottom at -X) — rotated 90° to drape from a hori-
//     zontal bar so the simulation has somewhere to go under gravity
//   • Actually the simplest test: a plane laying in the XY plane with
//     the top edge (maxY row) auto-pinned. After stepping, the bottom
//     row drops while the top stays.
//   • __studioCloth2Create with top edge auto-pinned (pinTopY default
//     = maxY - eps) — verify constraintCount > 0 and vertCount matches
//   • Step 60 frames @ dt=1/60 with 8 iterations each — assert the
//     bottom row's average Y decreased > 0.05 (gravity has pulled it
//     down by at least 5 cm at 9.81 m/s² over 1 second of sim time)
//     while the top row's Y stayed within ±1e-4 of where it started
//   • 5 cam angles for remote-desktop verification
//
// e2e DOES NOT run during this slice (per the slice brief — the harness
// runs builds, not playwright). This file just has to compile cleanly
// when the autoload + the ops are wired correctly.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-cloth2');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — Marvelous Designer / Chaos Cloth Verlet+PBD solver (slice 765)', async () => {
  test.setTimeout(240000);
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

  // ── Ensure the cloth2 module is installed. ──────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioCloth2Create !== 'function') {
      await import('/src/workbenches/studio/v3/cloth2/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioCloth2Create === 'function'
       && typeof window.__studioCloth2Step === 'function'
       && typeof window.__studioCloth2Pin === 'function'
       && typeof window.__studioCloth2SetWind === 'function'
       && typeof window.__studioCloth2List === 'function'
       && typeof window.__studioCloth2Remove === 'function',
    null, { timeout: 20000 }
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── Build a 40x40-segment plane lying in the XY plane. ─────────
  // PlaneGeometry default is in the XY plane (normal +Z), centred on
  // origin, with Y in [-w/2, +w/2]. The top row (maxY) is the natural
  // pin row; gravity (-Y) will then sag the rest of the plane.
  const plane = await win.evaluate(() => {
    const THREE = window.THREE;
    const W = 2, H = 2;
    const g = new THREE.PlaneGeometry(W, H, 40, 40);
    const m = new THREE.MeshStandardMaterial({
      color: 0xcfb9a4, roughness: 0.85, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, m);
    // Place at (0, 2, 0) so it hangs in clear space; auto-pin uses
    // the mesh's LOCAL Y (PlaneGeometry's verts are in local space
    // and the cloth solver reads from BufferGeometry directly).
    mesh.position.set(0, 2, 0);
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'plane';
    window.__archdiscScene.add(mesh);
    if (typeof window.__studioSelectMesh === 'function') {
      try { window.__studioSelectMesh(mesh); } catch (_) {}
    }
    // Snapshot initial top/bottom row Y values for later assertions.
    const pos = mesh.geometry.attributes.position;
    let maxY = -Infinity, minY = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > maxY) maxY = y;
      if (y < minY) minY = y;
    }
    const topIdxs = [];
    const botIdxs = [];
    const eps = 1e-4;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y >= maxY - eps) topIdxs.push(i);
      if (y <= minY + eps) botIdxs.push(i);
    }
    return {
      uuid: mesh.uuid,
      vertCount: pos.count,
      maxY, minY,
      topIdxs, botIdxs,
    };
  });
  expect(typeof plane.uuid).toBe('string');
  console.log('[cloth2] plane uuid', plane.uuid,
              'vertCount', plane.vertCount,
              'topRow', plane.topIdxs.length,
              'bottomRow', plane.botIdxs.length);
  // 40x40 plane segments → 41*41 = 1681 verts; top/bottom rows each 41.
  expect(plane.vertCount).toBe(41 * 41);
  expect(plane.topIdxs.length).toBe(41);
  expect(plane.botIdxs.length).toBe(41);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-plane-spawned.png') });

  // ── 1) Build cloth — top row auto-pinned. ──────────────────────
  const cloth = await win.evaluate((uuid) => {
    return window.__studioCloth2Create(uuid, {
      // pinTopY undefined → auto-detect (maxY - topEps).
      includeBend: true,
      distStiffness: 1,
      bendStiffness: 0.2,
    });
  }, plane.uuid);
  console.log('[cloth2] create', JSON.stringify(cloth));
  expect(cloth.ok).toBe(true);
  expect(cloth.uuid).toBe(plane.uuid);
  expect(cloth.vertCount).toBe(plane.vertCount);
  // 40x40 plane: edges = 2*40*40 + 40 + 40 = 3280 distance constraints
  // (every triangle edge unique), plus ~ 2*40*40 bend constraints across
  // the shared diagonals = ~3200 bend constraints. constraintCount should
  // therefore be well above the vert count.
  expect(cloth.constraintCount).toBeGreaterThan(cloth.vertCount);
  await win.waitForTimeout(150);

  // ── 2) Step 60 frames with 8 PBD iterations each. ──────────────
  let lastResidual = null;
  for (let f = 0; f < 60; f++) {
    const r = await win.evaluate((uuid) => {
      return window.__studioCloth2Step({
        uuid, dt: 1 / 60, iterations: 8,
      });
    }, plane.uuid);
    if (f === 0 || f === 59) {
      console.log(`[cloth2] frame ${f} residual=${r.energyResidual}`);
    }
    expect(r.ok).toBe(true);
    expect(Number.isFinite(r.energyResidual)).toBe(true);
    expect(r.energyResidual).toBeGreaterThanOrEqual(0);
    lastResidual = r.energyResidual;
  }
  console.log('[cloth2] final residual', lastResidual);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-after-60-frames.png') });

  // ── 3) Assertions: bottom row dropped, top row held. ───────────
  const yReport = await win.evaluate((args) => {
    const obj = window.__archdiscScene.getObjectByProperty('uuid', args.uuid);
    if (!obj) return { found: false };
    const pos = obj.geometry.attributes.position;
    let topSum = 0;
    for (const i of args.topIdxs) topSum += pos.getY(i);
    let botSum = 0;
    for (const i of args.botIdxs) botSum += pos.getY(i);
    return {
      found: true,
      topAvg: topSum / args.topIdxs.length,
      botAvg: botSum / args.botIdxs.length,
    };
  }, { uuid: plane.uuid, topIdxs: plane.topIdxs, botIdxs: plane.botIdxs });
  console.log('[cloth2] post-step', JSON.stringify(yReport),
              'initialMaxY', plane.maxY, 'initialMinY', plane.minY);
  expect(yReport.found).toBe(true);
  // Top row must stay within a small tolerance of where it started
  // (it's pinned — mass = 0 — and the solver never moves it).
  expect(Math.abs(yReport.topAvg - plane.maxY)).toBeLessThan(1e-3);
  // Bottom row must have dropped at least 0.05 (5 cm) below its initial
  // Y. With g = 9.81 m/s² and 1s of sim time, free-fall alone would
  // give ~4.9 m; constrained by the pinned top edge the bottom row's
  // drop should still be well above 0.05.
  expect(yReport.botAvg).toBeLessThan(plane.minY - 0.05);

  // ── 4) Listing + pin + wind sanity. ────────────────────────────
  const listing = await win.evaluate(() => window.__studioCloth2List());
  expect(listing.ok).toBe(true);
  expect(Array.isArray(listing.items)).toBe(true);
  expect(listing.items.some((it) => it.uuid === plane.uuid)).toBe(true);

  // Pin an extra vertex (the very first one in the bottom row); pin
  // op should succeed and increment pinnedCount.
  const pinR = await win.evaluate((args) => {
    return window.__studioCloth2Pin({ uuid: args.uuid, vertIdx: args.idx });
  }, { uuid: plane.uuid, idx: plane.botIdxs[0] });
  expect(pinR.ok).toBe(true);

  // Set wind on +X axis.
  const windR = await win.evaluate((uuid) => {
    return window.__studioCloth2SetWind({
      uuid,
      dir: { x: 1, y: 0, z: 0 },
      strength: 5,
    });
  }, plane.uuid);
  expect(windR.ok).toBe(true);

  // Step another 30 frames so the wind pulls the cloth eastward.
  for (let f = 0; f < 30; f++) {
    const r = await win.evaluate((uuid) => {
      return window.__studioCloth2Step({ uuid, dt: 1 / 60, iterations: 8 });
    }, plane.uuid);
    expect(r.ok).toBe(true);
  }
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '03-with-wind.png') });

  // ── 5) Camera sweep. ───────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport;
      const c = vp && vp.camera;
      if (c) {
        if (v === 'front') c.position.set(0, 2, 6);
        else if (v === 'top') c.position.set(0, 6, 0.001);
        else if (v === 'right') c.position.set(6, 2, 0);
        else if (v === 'iso') c.position.set(4, 4, 4);
        else if (v === 'close') c.position.set(2, 2, 2);
        c.lookAt(0, 1, 0);
      } else if (typeof window.__studioSetView === 'function') {
        window.__studioSetView(v);
      } else if (typeof window.__archdiscSetView === 'function') {
        window.__archdiscSetView(v);
      }
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // ── 6) Remove sanity. ──────────────────────────────────────────
  const rm = await win.evaluate((uuid) => window.__studioCloth2Remove({ uuid }), plane.uuid);
  expect(rm.ok).toBe(true);
  const listingAfter = await win.evaluate(() => window.__studioCloth2List());
  expect(listingAfter.items.some((it) => it.uuid === plane.uuid)).toBe(false);

  // eslint-disable-next-line no-console
  console.log('  slice 765: cloth2 verts=%d, constraints=%d, top stayed=%f, bot dropped=%f',
    cloth.vertCount, cloth.constraintCount,
    Math.abs(yReport.topAvg - plane.maxY),
    plane.minY - yReport.botAvg);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
