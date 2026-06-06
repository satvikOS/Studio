// ArchDisc Studio V3 — Maya MultiCut + Bridge edges + Bevel edges trio
// (slice 756).
//
// Headed Mac-Electron spec. Asserts the five mesh-edit ops shipped by
// v3/meshedit/ are real:
//   • __studioMeshBridge stitches a quad strip between two parallel
//     border edge loops
//   • __studioMeshMultiCut inserts a chain of new verts + splits
//     crossed tris
//   • __studioMeshBevelEdges produces real offset rims + quad strip
//   • __studioMeshExtrudeEdge adds an axis-aligned quad
//   • __studioMeshDeleteFace drops a tri
// + 5 named camera angles for remote-desktop verification.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-meshedit');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — Maya MultiCut + Bridge + Bevel edges trio', async () => {
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

  // Belt-and-braces: autoload usually runs via api.js but force-import for
  // robust ordering during this slice's first run.
  await win.evaluate(async () => {
    if (typeof window.__studioMeshBridge !== 'function') {
      await import('/src/workbenches/studio/v3/meshedit/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioMeshBridge === 'function',
    null, { timeout: 20000 });
  await win.waitForFunction(() => typeof window.__studioMeshMultiCut === 'function',
    null, { timeout: 20000 });
  await win.waitForFunction(() => typeof window.__studioMeshBevelEdges === 'function',
    null, { timeout: 20000 });
  await win.waitForFunction(() => typeof window.__studioMeshExtrudeEdge === 'function',
    null, { timeout: 20000 });
  await win.waitForFunction(() => typeof window.__studioMeshDeleteFace === 'function',
    null, { timeout: 20000 });
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Bridge: build a 4-vert quad mesh (two parallel 2-vert edges)
  //         and bridge them → 2 added faces (1 quad). ──────────────────
  const bridge = await win.evaluate(() => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    // Two parallel edges along Z at y=0:
    //   edge A: (0, 0, 0)  →  (1, 0, 0)         loopA = [0, 1]
    //   edge B: (0, 0, 1)  →  (1, 0, 1)         loopB = [2, 3]
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 0, 1,
      1, 0, 1,
    ]);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex([]);  // no faces yet — pure verts
    const mat = new THREE.MeshStandardMaterial({ color: 0x4488ff, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(0, 0.5, 0);
    scene.add(mesh);
    if (typeof window.__studioSelectMesh === 'function') {
      try { window.__studioSelectMesh(mesh.uuid); } catch (_) {}
    }
    const r = window.__studioMeshBridge(mesh.uuid, [0, 1], [2, 3], { closeLoop: false });
    const m = scene.getObjectByProperty('uuid', mesh.uuid);
    const idxCount = m && m.geometry && m.geometry.index ? m.geometry.index.count : 0;
    return { r, uuid: mesh.uuid, idxCount };
  });
  console.log('[mesh] bridge', JSON.stringify(bridge.r), 'idxCount', bridge.idxCount);
  expect(bridge.r.ok).toBe(true);
  expect(bridge.r.addedFaces).toBe(2);    // 1 quad = 2 tris
  expect(bridge.r.addedQuads).toBe(1);
  expect(bridge.idxCount).toBe(6);        // 2 tris × 3 indices

  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-bridge.png') });

  // ── 2) MultiCut: build a plane (two CCW tris on XZ at y=0) and cut
  //         a vertical slice across both. The cut line crosses both tris.
  const cut = await win.evaluate(() => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    // Plane verts:
    //   0: (-1, 0, -1)   1: (1, 0, -1)
    //   2: (-1, 0,  1)   3: (1, 0,  1)
    // Tris: (0,1,2), (1,3,2)
    const positions = new Float32Array([
      -1, 0, -1,
       1, 0, -1,
      -1, 0,  1,
       1, 0,  1,
    ]);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex([0, 1, 2, 1, 3, 2]);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff8844, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(3, 0.5, 0);
    scene.add(mesh);
    // MultiCut from vert 0 (-1,0,-1) to vert 3 (1,0,1) — the DIAGONAL
    // through both tris. Use segments=3 → 2 intermediate verts on the line.
    const r = window.__studioMeshMultiCut(mesh.uuid, 0, 3, 3);
    const m = scene.getObjectByProperty('uuid', mesh.uuid);
    const triAfter = m && m.geometry && m.geometry.index ? m.geometry.index.count / 3 : 0;
    return { r, triAfter };
  });
  console.log('[mesh] multiCut', JSON.stringify(cut.r), 'triAfter', cut.triAfter);
  expect(cut.r.ok).toBe(true);
  expect(cut.r.addedVerts).toBeGreaterThan(0);
  // Either added faces (tris crossed) or chain points placed; chain length = 4 (incl. endpoints).
  expect(cut.r.vertChain.length).toBe(4);

  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-multicut.png') });

  // ── 3) Bevel edges: build a wing (two tris sharing edge 1-2) and
  //         bevel that interior edge. ──────────────────────────────────
  const bevel = await win.evaluate(() => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    // 4 verts forming a quad split into 2 tris that share edge (1, 2):
    //   0: (0, 0, 0)   1: (1, 0, 0)
    //   2: (0, 0, 1)   3: (1, 0, 1)
    // Tri A: (0, 1, 2)   Tri B: (1, 3, 2)   shared edge 1-2.
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 0, 1,
      1, 0, 1,
    ]);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex([0, 1, 2, 1, 3, 2]);
    const mat = new THREE.MeshStandardMaterial({ color: 0x44dd66, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(-3, 0.5, 0);
    scene.add(mesh);
    const r = window.__studioMeshBevelEdges(mesh.uuid, [[1, 2]], 0.1);
    const m = scene.getObjectByProperty('uuid', mesh.uuid);
    const vertCount = m && m.geometry && m.geometry.attributes.position
      ? m.geometry.attributes.position.count : 0;
    const triAfter = m && m.geometry && m.geometry.index ? m.geometry.index.count / 3 : 0;
    return { r, vertCount, triAfter };
  });
  console.log('[mesh] bevel', JSON.stringify(bevel.r), 'verts', bevel.vertCount, 'tris', bevel.triAfter);
  expect(bevel.r.ok).toBe(true);
  expect(bevel.r.beveled).toBe(1);
  expect(bevel.r.addedFaces).toBe(2);     // 1 strip quad = 2 tris
  expect(bevel.vertCount).toBe(8);        // 4 original + 4 offset duplicates
  expect(bevel.triAfter).toBe(4);         // 2 original (re-wired) + 2 strip

  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '03-bevel.png') });

  // ── 4) Extrude edge: extrude triangle 0's first edge along +Y by 0.5.
  const extr = await win.evaluate(() => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 0, 1,
    ]);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex([0, 1, 2]);
    const mat = new THREE.MeshStandardMaterial({ color: 0xaa44ff, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(0, 0.5, -3);
    scene.add(mesh);
    const r = window.__studioMeshExtrudeEdge(mesh.uuid, 0, 0.5, 'y');
    const m = scene.getObjectByProperty('uuid', mesh.uuid);
    const vertCount = m && m.geometry && m.geometry.attributes.position
      ? m.geometry.attributes.position.count : 0;
    const triAfter = m && m.geometry && m.geometry.index ? m.geometry.index.count / 3 : 0;
    return { r, vertCount, triAfter };
  });
  console.log('[mesh] extrude', JSON.stringify(extr.r), 'verts', extr.vertCount, 'tris', extr.triAfter);
  expect(extr.r.ok).toBe(true);
  expect(extr.r.addedFaces).toBe(2);
  expect(extr.vertCount).toBe(5);   // 3 + 2 duplicated
  expect(extr.triAfter).toBe(3);    // 1 original + 2 quad halves

  // ── 5) Delete face: drop a tri from a 2-tri quad. ────────────────
  const del = await win.evaluate(() => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 0, 1,
      1, 0, 1,
    ]);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex([0, 1, 2, 1, 3, 2]);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffaa00, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(0, 0.5, 3);
    scene.add(mesh);
    const r = window.__studioMeshDeleteFace(mesh.uuid, 0);
    const m = scene.getObjectByProperty('uuid', mesh.uuid);
    const triAfter = m && m.geometry && m.geometry.index ? m.geometry.index.count / 3 : 0;
    return { r, triAfter };
  });
  console.log('[mesh] deleteFace', JSON.stringify(del.r), 'triAfter', del.triAfter);
  expect(del.r.ok).toBe(true);
  expect(del.r.triAfter).toBe(1);
  expect(del.triAfter).toBe(1);

  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '04-deleteFace.png') });

  // ── 6) Global search surfaces the new ops. ───────────────────────
  const search = await win.evaluate(() => {
    if (typeof window.__studioCommandSearch !== 'function') return { ok: false, names: [] };
    const r = window.__studioCommandSearch('mesh bridge', 60);
    return { ok: r.ok, names: (r.hits || []).map((h) => h.name) };
  });
  console.log('[mesh] search hits:', JSON.stringify(search.names.slice(0, 10)));
  if (search.ok) {
    expect(search.names.some((n) => /MeshBridge/i.test(n))).toBe(true);
  }

  // ── 7) Camera sweep. ──────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 756: bridge', bridge.r.addedFaces, ', multiCut +verts', cut.r.addedVerts,
    ', bevel +faces', bevel.r.addedFaces, ', extrude +faces', extr.r.addedFaces,
    ', delete triAfter', del.triAfter);

  await app.close();
});
