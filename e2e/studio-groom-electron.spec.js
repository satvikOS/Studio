// ArchDisc Studio V3 — Unreal Groom / Maya XGen / Blender Hair groom
// module (slice 760).
//
// Headed Mac-Electron spec. Verifies the real strand engine:
//   • boot the V3 shell, install the groom autoload
//   • spawn a unit sphere at the origin
//   • __studioGroomCreate(sphereUuid, {count:500, length:0.01,
//                                       segments:8, seed:1337}) ok
//   • the returned uuid resolves to a THREE.LineSegments in the scene
//   • comb the top half: brush center (0, 1, 0), direction (1, 0, 0),
//     radius 1.0, strength 0.5 → perturbedCount > 0 AND less than the
//     full strand count (some strands are below the equator, not in
//     the brush radius)
//   • SetMode 'ribbons' → swap renderable; the scene now holds a Mesh
//     (not LineSegments) with the same userData[archdiscStudioGroom]
//   • 5 cam angles for remote-desktop verification
//
// e2e DOES NOT run during this slice (per the slice brief — the harness
// runs builds, not playwright). This file just has to compile cleanly
// when the autoload + the ops are wired correctly.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-groom');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — Unreal Groom / Maya XGen hair grooming (slice 760)', async () => {
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

  // ── Ensure the groom module is installed. ──────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioGroomCreate !== 'function') {
      await import('/src/workbenches/studio/v3/groom/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioGroomCreate === 'function'
       && typeof window.__studioGroomComb === 'function'
       && typeof window.__studioGroomLength === 'function'
       && typeof window.__studioGroomList === 'function'
       && typeof window.__studioGroomRemove === 'function'
       && typeof window.__studioGroomSetMode === 'function',
    null, { timeout: 20000 }
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── Spawn a unit sphere as the source surface. ─────────────────────
  const sphere = await win.evaluate(() => {
    const THREE = window.THREE;
    const g = new THREE.SphereGeometry(1, 64, 64);
    const m = new THREE.MeshStandardMaterial({ color: 0x4477aa, roughness: 0.7 });
    const mesh = new THREE.Mesh(g, m);
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'sphere';
    window.__archdiscScene.add(mesh);
    if (typeof window.__studioSelectMesh === 'function') {
      try { window.__studioSelectMesh(mesh); } catch (_) {}
    }
    return { uuid: mesh.uuid };
  });
  expect(typeof sphere.uuid).toBe('string');
  console.log('[groom] sphere uuid', sphere.uuid);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-sphere.png') });

  // ── 1) Create a 500-strand groom of length 0.01. ──────────────────
  const groom = await win.evaluate((uuid) => {
    return window.__studioGroomCreate(uuid, {
      count: 500, length: 0.01, segments: 8, seed: 1337,
    });
  }, sphere.uuid);
  console.log('[groom] create', JSON.stringify(groom));
  expect(groom.ok).toBe(true);
  expect(typeof groom.uuid).toBe('string');
  expect(groom.strandCount).toBe(500);

  // Verify the renderable mesh is actually in the scene.
  const inScene = await win.evaluate((uuid) => {
    const o = window.__archdiscScene.getObjectByProperty('uuid', uuid);
    if (!o) return { found: false };
    return {
      found: true,
      isLineSegments: !!o.isLineSegments,
      isMesh: !!o.isMesh,
      hasGroomTag: !!(o.userData && o.userData.archdiscStudioGroom),
      mode: o.userData ? o.userData.archdiscStudioGroomMode : null,
      hasGeometry: !!(o.geometry && o.geometry.attributes
                      && o.geometry.attributes.position),
      vertCount: (o.geometry && o.geometry.attributes && o.geometry.attributes.position)
        ? o.geometry.attributes.position.count : 0,
    };
  }, groom.uuid);
  console.log('[groom] inScene', JSON.stringify(inScene));
  expect(inScene.found).toBe(true);
  expect(inScene.isLineSegments).toBe(true);
  expect(inScene.hasGroomTag).toBe(true);
  expect(inScene.mode).toBe('lines');
  expect(inScene.hasGeometry).toBe(true);
  // 500 strands * 8 segments * 2 verts per segment = 8000 verts.
  expect(inScene.vertCount).toBe(500 * 8 * 2);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-groom-created.png') });

  // ── 2) Comb the top half. ─────────────────────────────────────────
  // Brush center (0, 1, 0) at the north pole, radius 1.0 reaches the
  // upper hemisphere (any root with y > 0 is within distance 1 of the
  // pole on the unit sphere); direction +X pushes tips eastward.
  const comb = await win.evaluate((uuid) => {
    return window.__studioGroomComb({
      uuid,
      center: { x: 0, y: 1, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      radius: 1.0,
      strength: 0.5,
    });
  }, groom.uuid);
  console.log('[groom] comb', JSON.stringify(comb));
  expect(comb.ok).toBe(true);
  // Top-half strands must perturb but not the entire set (the bottom
  // half is outside the brush radius from (0,1,0) — minimum distance to
  // any south-hemisphere point on the unit sphere is √2 > 1).
  expect(comb.perturbedCount).toBeGreaterThan(0);
  expect(comb.perturbedCount).toBeLessThan(500);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '03-groom-combed.png') });

  // ── 3) Switch to ribbons mode. ────────────────────────────────────
  const setMode = await win.evaluate((uuid) => {
    return window.__studioGroomSetMode({ uuid, mode: 'ribbons' });
  }, groom.uuid);
  console.log('[groom] setMode', JSON.stringify(setMode));
  expect(setMode.ok).toBe(true);
  expect(setMode.mode).toBe('ribbons');
  // The uuid may have changed if THREE refused to retain the original;
  // resolve via setMode.uuid for the post-swap mesh check.
  const ribbonUuid = setMode.uuid || groom.uuid;
  const ribbonScene = await win.evaluate((uuid) => {
    const o = window.__archdiscScene.getObjectByProperty('uuid', uuid);
    if (!o) return { found: false };
    return {
      found: true,
      isMesh: !!o.isMesh,
      isLineSegments: !!o.isLineSegments,
      mode: o.userData ? o.userData.archdiscStudioGroomMode : null,
      hasGeometry: !!(o.geometry && o.geometry.attributes
                      && o.geometry.attributes.position),
      hasIndex: !!(o.geometry && o.geometry.index),
    };
  }, ribbonUuid);
  console.log('[groom] ribbonScene', JSON.stringify(ribbonScene));
  expect(ribbonScene.found).toBe(true);
  expect(ribbonScene.isMesh).toBe(true);
  expect(ribbonScene.isLineSegments).toBe(false);
  expect(ribbonScene.mode).toBe('ribbons');
  expect(ribbonScene.hasGeometry).toBe(true);
  expect(ribbonScene.hasIndex).toBe(true);

  // ── 4) List + Length sanity. ──────────────────────────────────────
  const listing = await win.evaluate(() => window.__studioGroomList());
  expect(listing.ok).toBe(true);
  expect(Array.isArray(listing.items)).toBe(true);
  expect(listing.items.some((it) => it.uuid === ribbonUuid)).toBe(true);
  const myItem = listing.items.find((it) => it.uuid === ribbonUuid);
  expect(myItem.strandCount).toBe(500);
  expect(myItem.mode).toBe('ribbons');

  // Length scaling preserves the comb; check it returns a non-zero
  // average length.
  const lengthR = await win.evaluate((uuid) => {
    return window.__studioGroomLength({ uuid, lengthMul: 2.0 });
  }, ribbonUuid);
  console.log('[groom] length', JSON.stringify(lengthR));
  expect(lengthR.ok).toBe(true);
  expect(lengthR.newAvgLength).toBeGreaterThan(0);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '04-groom-ribbons.png') });

  // ── 5) Camera sweep. ──────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport;
      const c = vp && vp.camera;
      if (c) {
        if (v === 'front') c.position.set(0, 0, 4);
        else if (v === 'top') c.position.set(0, 4, 0.001);
        else if (v === 'right') c.position.set(4, 0, 0);
        else if (v === 'iso') c.position.set(3, 3, 3);
        else if (v === 'close') c.position.set(1.5, 1.5, 1.5);
        c.lookAt(0, 0, 0);
      } else if (typeof window.__studioSetView === 'function') {
        window.__studioSetView(v);
      } else if (typeof window.__archdiscSetView === 'function') {
        window.__archdiscSetView(v);
      }
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // ── 6) Remove sanity. ─────────────────────────────────────────────
  const rm = await win.evaluate((uuid) => window.__studioGroomRemove({ uuid }), ribbonUuid);
  expect(rm.ok).toBe(true);
  const listingAfter = await win.evaluate(() => window.__studioGroomList());
  expect(listingAfter.items.some((it) => it.uuid === ribbonUuid)).toBe(false);

  // eslint-disable-next-line no-console
  console.log('  slice 760: groom strands=%d, combed=%d, mode→ribbons, length avg=%f',
    groom.strandCount, comb.perturbedCount, lengthR.newAvgLength);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
