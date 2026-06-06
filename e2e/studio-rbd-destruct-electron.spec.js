// ArchDisc Studio V3 — Houdini RBD destruction (slice 767).
//
// Headed Mac-Electron spec. Verifies the real fracture + sim pipeline:
//   • boot the V3 shell, install the rbddestruct autoload
//   • spawn a unit cube
//   • __studioRBDFracture({meshUuid, sites:8, seed:1337}) ok &
//     chunkCount === 8 (every Voronoi cell for uniform sites inside an
//     AABB is non-empty — empty cells would fail this)
//   • __studioRBDExplode({setKey, impulseScale:8}) → ok
//   • __studioRBDStep 60 frames with dt=1/60 s
//   • assert chunks moved apart — average pairwise distance after the
//     sim must be > average pairwise distance before
//   • 5 cam angles (front/iso/right/top/close)
//
// e2e DOES NOT run during this slice (per the slice brief — the harness
// runs builds, not playwright). This file just has to compile cleanly
// and pass when the autoload + the ops are wired correctly.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-rbd-destruct');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — Houdini RBD destruction: Voronoi fracture + rigid body sim (slice 767)', async () => {
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

  // ── Ensure the RBD destruct module is installed. ──────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioRBDFracture !== 'function') {
      await import('/src/workbenches/studio/v3/rbddestruct/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioRBDFracture === 'function'
       && typeof window.__studioRBDStep === 'function'
       && typeof window.__studioRBDExplode === 'function'
       && typeof window.__studioRBDList === 'function'
       && typeof window.__studioRBDClear === 'function',
    null, { timeout: 20000 }
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── Spawn a 2-unit cube as the source mesh. ────────────────────────
  const cube = await win.evaluate(() => {
    const THREE = window.THREE;
    const g = new THREE.BoxGeometry(2, 2, 2);
    const m = new THREE.MeshStandardMaterial({ color: 0xbb6633, roughness: 0.7 });
    const mesh = new THREE.Mesh(g, m);
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'cube';
    mesh.position.set(0, 2, 0);
    window.__archdiscScene.add(mesh);
    if (typeof window.__studioSelectMesh === 'function') {
      try { window.__studioSelectMesh(mesh); } catch (_) {}
    }
    return { uuid: mesh.uuid };
  });
  expect(typeof cube.uuid).toBe('string');
  console.log('[rbd] cube uuid', cube.uuid);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-cube.png') });

  // ── 1) Fracture into 8 sites. ─────────────────────────────────────
  const frac = await win.evaluate((uuid) => {
    return window.__studioRBDFracture({
      meshUuid: uuid, sites: 8, seed: 1337,
    });
  }, cube.uuid);
  console.log('[rbd] fracture', JSON.stringify(frac));
  expect(frac.ok).toBe(true);
  expect(typeof frac.setKey).toBe('string');
  expect(frac.chunkCount).toBe(8);

  // Verify chunks are in scene + source mesh is hidden.
  const sceneState = await win.evaluate((uuid) => {
    const src = window.__archdiscScene.getObjectByProperty('uuid', uuid);
    const chunks = [];
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioRBDChunk) chunks.push(o.uuid);
    });
    return { srcVisible: !!(src && src.visible), chunkCount: chunks.length };
  }, cube.uuid);
  console.log('[rbd] sceneState', JSON.stringify(sceneState));
  expect(sceneState.srcVisible).toBe(false);
  expect(sceneState.chunkCount).toBe(8);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-fractured.png') });

  // Record chunk positions BEFORE explode/step.
  const before = await win.evaluate((setKey) => {
    const arr = [];
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioRBDChunk === setKey) {
        arr.push([o.position.x, o.position.y, o.position.z]);
      }
    });
    return arr;
  }, frac.setKey);
  expect(before.length).toBe(8);

  // ── 2) Explode + step 60 frames. ─────────────────────────────────
  const explode = await win.evaluate((setKey) => {
    return window.__studioRBDExplode({ setKey, impulseScale: 8 });
  }, frac.setKey);
  console.log('[rbd] explode', JSON.stringify(explode));
  expect(explode.ok).toBe(true);

  for (let i = 0; i < 60; i++) {
    await win.evaluate(({ setKey, dt }) => {
      return window.__studioRBDStep({ setKey, dt });
    }, { setKey: frac.setKey, dt: 1 / 60 });
  }
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '03-exploded.png') });

  // Record chunk positions AFTER step.
  const after = await win.evaluate((setKey) => {
    const arr = [];
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioRBDChunk === setKey) {
        arr.push([o.position.x, o.position.y, o.position.z]);
      }
    });
    return arr;
  }, frac.setKey);
  expect(after.length).toBe(8);

  // Mean pairwise distance: chunks should be further apart after.
  const meanPair = (pts) => {
    let sum = 0, n = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i][0] - pts[j][0];
        const dy = pts[i][1] - pts[j][1];
        const dz = pts[i][2] - pts[j][2];
        sum += Math.hypot(dx, dy, dz);
        n++;
      }
    }
    return n ? sum / n : 0;
  };
  const meanBefore = meanPair(before);
  const meanAfter  = meanPair(after);
  console.log('[rbd] meanBefore=%f meanAfter=%f', meanBefore, meanAfter);
  expect(meanAfter).toBeGreaterThan(meanBefore);

  // ── 3) List + sleep stats. ────────────────────────────────────────
  const listing = await win.evaluate(() => window.__studioRBDList());
  console.log('[rbd] list', JSON.stringify(listing));
  expect(listing.ok).toBe(true);
  expect(listing.sets.length).toBeGreaterThanOrEqual(1);
  const mySet = listing.sets.find((s) => s.setKey === frac.setKey);
  expect(mySet).toBeTruthy();
  expect(mySet.chunkCount).toBe(8);

  // ── 4) Camera sweep. ──────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport;
      const c = vp && vp.camera;
      if (c) {
        if (v === 'front') c.position.set(0, 2, 8);
        else if (v === 'top') c.position.set(0, 10, 0.001);
        else if (v === 'right') c.position.set(8, 2, 0);
        else if (v === 'iso') c.position.set(6, 6, 6);
        else if (v === 'close') c.position.set(3, 3, 3);
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

  // ── 5) Clear sanity. ──────────────────────────────────────────────
  const cleared = await win.evaluate((setKey) => {
    return window.__studioRBDClear({ setKey });
  }, frac.setKey);
  console.log('[rbd] clear', JSON.stringify(cleared));
  expect(cleared.ok).toBe(true);
  expect(cleared.removed).toBe(8);
  const listingAfter = await win.evaluate(() => window.__studioRBDList());
  expect(listingAfter.sets.find((s) => s.setKey === frac.setKey)).toBeFalsy();

  // Source mesh should be visible again.
  const srcAfter = await win.evaluate((uuid) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', uuid);
    return { visible: !!(m && m.visible) };
  }, cube.uuid);
  expect(srcAfter.visible).toBe(true);

  // eslint-disable-next-line no-console
  console.log('  slice 767: rbd chunks=%d, meanBefore=%f, meanAfter=%f',
    frac.chunkCount, meanBefore, meanAfter);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
