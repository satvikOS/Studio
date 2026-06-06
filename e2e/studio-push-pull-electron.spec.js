// ArchDisc Studio — SketchUp interactive Push/Pull (slice 747).
//
// Headed Mac-Electron spec. Studio's `extrudeFaces` shoved every vertex
// along its normal; SketchUp's PushPullTool extrudes a SINGLE face by
// duplicating the cap verts, building real side quads along the
// boundary, and growing volume by exactly faceArea × distance. This
// spec proves the surgery on a unit BoxGeometry.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-push-pull');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio — SketchUp interactive Push/Pull (slice 747)', async () => {
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
    () => !!window.__archdiscScene && !!window.THREE
       && typeof window.__studioPushPullFace === 'function',
    null, { timeout: 30000 },
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Build a unit cube + select. ───────────────────────────────
  const seed = await win.evaluate(() => {
    const THREE = window.THREE;
    const geom = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    const m = new THREE.Mesh(geom, mat);
    m.userData.archdiscStudioPrimitive = true;
    m.userData.archdiscStudioPrimitiveKind = 'cube';
    window.__archdiscScene.add(m);
    if (typeof window.__studioSelectMesh === 'function') window.__studioSelectMesh(m);
    // Compute initial volume from positions. For a unit cube it's 1.
    return {
      uuid: m.uuid,
      tris: m.geometry.index
        ? m.geometry.index.count / 3
        : m.geometry.attributes.position.count / 3,
    };
  });
  console.log('[pp] seed', JSON.stringify(seed));
  expect(seed.tris).toBeGreaterThanOrEqual(12); // BoxGeometry = 12 triangles

  // ── 2) Find a triangle on the +Y top face (normal close to (0,1,0)).
  const topFace = await win.evaluate((uuid) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', uuid);
    const g = m.geometry;
    const idx = g.index ? g.index.array : null;
    const pos = g.attributes.position;
    const triCount = idx ? idx.length / 3 : pos.count / 3;
    let bestIdx = -1, bestY = -2;
    const tmp = new window.THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3]     : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
      const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
      const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);
      const ex1 = bx - ax, ey1 = by - ay, ez1 = bz - az;
      const ex2 = cx - ax, ey2 = cy - ay, ez2 = cz - az;
      const nx = ey1 * ez2 - ez1 * ey2;
      const ny = ez1 * ex2 - ex1 * ez2;
      const nz = ex1 * ey2 - ey1 * ex2;
      const L = Math.hypot(nx, ny, nz) || 1;
      const nyN = ny / L;
      if (nyN > bestY) { bestY = nyN; bestIdx = t; }
    }
    return { faceIdx: bestIdx, ny: bestY };
  }, seed.uuid);
  console.log('[pp] top-face pick', JSON.stringify(topFace));
  expect(topFace.ny).toBeGreaterThan(0.95);

  // ── 3) Push the top face by +0.5. Volume must grow by exactly 0.5
  //      (top face area is 1, so delta volume = 1 × 0.5 = 0.5).
  const before = await win.evaluate((uuid) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', uuid);
    const g = m.geometry;
    const idx = g.index ? g.index.array : null;
    const pos = g.attributes.position;
    let V = 0;
    const triCount = idx ? idx.length / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3]     : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const x1 = pos.getX(i0), y1 = pos.getY(i0), z1 = pos.getZ(i0);
      const x2 = pos.getX(i1), y2 = pos.getY(i1), z2 = pos.getZ(i1);
      const x3 = pos.getX(i2), y3 = pos.getY(i2), z3 = pos.getZ(i2);
      // Signed tetra volume of the triangle with origin.
      V += (x1 * (y2 * z3 - y3 * z2)
          + x2 * (y3 * z1 - y1 * z3)
          + x3 * (y1 * z2 - y2 * z1)) / 6;
    }
    // bbox bottom Y
    g.computeBoundingBox();
    return { V: Math.abs(V), bottomY: g.boundingBox.min.y, topY: g.boundingBox.max.y };
  }, seed.uuid);
  console.log('[pp] volume before', before);
  expect(before.V).toBeCloseTo(1.0, 3);
  expect(before.topY).toBeCloseTo(0.5, 4);

  const r = await win.evaluate((args) => window.__studioPushPullFace(args.uuid, args.fi, 0.5),
    { uuid: seed.uuid, fi: topFace.faceIdx });
  console.log('[pp] surgery', JSON.stringify(r));
  expect(r.ok).toBe(true);
  expect(r.faceArea).toBeCloseTo(1.0, 5);     // top face is 1×1
  expect(r.capTris).toBe(2);                  // 2 triangles for a quad face
  expect(r.sideTris).toBe(8);                 // 4 boundary edges × 2 = 8

  const after = await win.evaluate((uuid) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', uuid);
    const g = m.geometry;
    const idx = g.index ? g.index.array : null;
    const pos = g.attributes.position;
    let V = 0;
    const triCount = idx ? idx.length / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3]     : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const x1 = pos.getX(i0), y1 = pos.getY(i0), z1 = pos.getZ(i0);
      const x2 = pos.getX(i1), y2 = pos.getY(i1), z2 = pos.getZ(i1);
      const x3 = pos.getX(i2), y3 = pos.getY(i2), z3 = pos.getZ(i2);
      V += (x1 * (y2 * z3 - y3 * z2)
          + x2 * (y3 * z1 - y1 * z3)
          + x3 * (y1 * z2 - y2 * z1)) / 6;
    }
    g.computeBoundingBox();
    return {
      V: Math.abs(V),
      bottomY: g.boundingBox.min.y,
      topY: g.boundingBox.max.y,
      tris: triCount,
      pushPulled: m.userData.archdiscStudioPushPulled,
    };
  }, seed.uuid);
  console.log('[pp] after', after);
  // 1.0 + 0.5 = 1.5.
  expect(after.V).toBeCloseTo(1.5, 3);
  // Bottom face Y unchanged (still -0.5), top face Y = +1.0.
  expect(after.bottomY).toBeCloseTo(before.bottomY, 5);
  expect(after.topY).toBeCloseTo(1.0, 4);
  expect(after.pushPulled).toBe(1);

  // ── 4) Interactive begin / update / commit on a fresh cube.
  const live = await win.evaluate(() => {
    const THREE = window.THREE;
    const g = new THREE.BoxGeometry(0.4, 0.4, 0.4, 1, 1, 1);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4488ff }));
    m.position.set(2, 0, 0);
    m.userData.archdiscStudioPrimitive = true;
    m.userData.archdiscStudioPrimitiveKind = 'cube';
    window.__archdiscScene.add(m);
    window.__studioSelectMesh(m);
    // Pick the top face.
    const idx = g.index ? g.index.array : null;
    const pos = g.attributes.position;
    const triCount = idx ? idx.length / 3 : pos.count / 3;
    let bestI = -1, bestY = -2;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3]     : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const ay = pos.getY(i0), by = pos.getY(i1), cy = pos.getY(i2);
      const ax = pos.getX(i0), bx = pos.getX(i1), cx = pos.getX(i2);
      const az = pos.getZ(i0), bz = pos.getZ(i1), cz = pos.getZ(i2);
      const ex1 = bx - ax, ey1 = by - ay, ez1 = bz - az;
      const ex2 = cx - ax, ey2 = cy - ay, ez2 = cz - az;
      const ny = ez1 * ex2 - ex1 * ez2;
      const L = Math.hypot(ey1 * ez2 - ez1 * ey2, ny, ex1 * ey2 - ey1 * ex2) || 1;
      if (ny / L > bestY) { bestY = ny / L; bestI = t; }
    }
    const s1 = window.__studioPushPullStart(m.uuid, bestI);
    const u1 = window.__studioPushPullUpdate(0.1);
    const u2 = window.__studioPushPullUpdate(0.3);
    const c1 = window.__studioPushPullCommit();
    // Bbox: original 0.4 cube → height 0.4 + 0.3 = 0.7
    const g2 = m.geometry;
    g2.computeBoundingBox();
    return {
      s1, u1, u2, c1,
      topY: g2.boundingBox.max.y,
      bottomY: g2.boundingBox.min.y,
      pushPulled: m.userData.archdiscStudioPushPulled,
    };
  });
  console.log('[pp] live', JSON.stringify(live));
  expect(live.s1.ok).toBe(true);
  expect(live.u1.ok).toBe(true);
  expect(live.u2.ok).toBe(true);
  expect(live.c1.ok).toBe(true);
  expect(live.c1.distance).toBeCloseTo(0.3, 4);
  expect(live.topY).toBeCloseTo(0.5, 3);   // bottom -0.2 + height 0.4 + 0.3 = +0.5
  expect(live.bottomY).toBeCloseTo(-0.2, 3);

  // ── 5) Camera sweep.
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 747: surgery V before=', before.V, '-> after=', after.V,
              ', faceArea=', r.faceArea, ', capTris=', r.capTris, ', sideTris=', r.sideTris);

  try { await app.close(); } catch (_) { /* worker teardown best-effort */ }
});
