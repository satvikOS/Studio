// ArchDisc Studio V3 — Geometry Nodes 2 batch (slice 757).
//
// Headed Mac-Electron spec for the five new GN2 ops:
//   __studioGN2InstanceOnPoints
//   __studioGN2RealizeInstances
//   __studioGN2MergeByDistance
//   __studioGN2TransformGeometry
//   __studioGN2Subdivide
//
// Asserts:
//   • Spawn a unit cube directly in the scene.
//   • InstanceOnPoints with 4 sample points → InstancedMesh.count === 4
//     and the matrix at index 0 places the prototype at the requested
//     position.
//   • RealizeInstances bakes that instanced mesh into a single
//     BufferGeometry whose vertex count = 4 × source verts.
//   • TransformGeometry bakes a translate(2,0,0) into a cube and the
//     mesh's local position stays at the origin.
//   • Subdivide raises the vertex count.
//   • MergeByDistance on a 2-cube weld geometry (where vert positions
//     overlap) reports mergedVerts > 0.
//   • 5 named camera angles get captured.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-geomnodes2');
const NAMED_VIEWS = ['front', 'top', 'right', 'iso', 'close'];

test('Studio V3 — geometry nodes 2 batch (slice 757)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 160,
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

  // Make sure the GN2 ops are installed. The autoload runs from api.js
  // but we belt-and-braces import it via the dev server too.
  await win.evaluate(async () => {
    if (typeof window.__studioGN2InstanceOnPoints !== 'function') {
      await import('/src/workbenches/studio/v3/geomnodes2/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioGN2InstanceOnPoints === 'function'
       && typeof window.__studioGN2RealizeInstances === 'function'
       && typeof window.__studioGN2MergeByDistance === 'function'
       && typeof window.__studioGN2TransformGeometry === 'function'
       && typeof window.__studioGN2Subdivide === 'function',
    null, { timeout: 20000 }
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Seed a unit cube into the scene. ───────────────────────────
  const seed = await win.evaluate(() => {
    const THREE = window.THREE;
    const geom = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    const m = new THREE.Mesh(geom, mat);
    m.userData.archdiscStudioPrimitive = true;
    m.userData.archdiscStudioPrimitiveKind = 'cube';
    window.__archdiscScene.add(m);
    if (typeof window.__studioSelectMesh === 'function') window.__studioSelectMesh(m);
    return {
      uuid: m.uuid,
      verts: m.geometry.attributes.position.count,
    };
  });
  console.log('[gn2] seed cube', JSON.stringify(seed));
  expect(typeof seed.uuid).toBe('string');
  expect(seed.verts).toBeGreaterThan(0);

  // ── 2) InstanceOnPoints with 4 sample points. ────────────────────
  const inst = await win.evaluate((sourceUuid) => {
    const pts = [
      { pos: [0, 0, 0], normal: [0, 1, 0] },
      { pos: [2, 0, 0], normal: [0, 1, 0] },
      { pos: [0, 0, 2], normal: [1, 0, 0] },
      { pos: [2, 0, 2], normal: [0, 0, 1] },
    ];
    const r = window.__studioGN2InstanceOnPoints(sourceUuid, pts, { scale: 0.5 });
    if (!r.ok) return r;
    const obj = window.__archdiscScene.getObjectByProperty('uuid', r.uuid);
    const isInst = !!(obj && obj.isInstancedMesh);
    const THREE = window.THREE;
    const m = new THREE.Matrix4();
    let firstX = null;
    if (isInst && obj.count > 0) {
      obj.getMatrixAt(0, m);
      const p = new THREE.Vector3();
      p.setFromMatrixPosition(m);
      firstX = p.x;
    }
    return { ok: r.ok, uuid: r.uuid, count: r.count, isInst, instCount: obj ? obj.count : 0, firstX };
  }, seed.uuid);
  console.log('[gn2] instanceOnPoints', JSON.stringify(inst));
  expect(inst.ok).toBe(true);
  expect(inst.count).toBe(4);
  expect(inst.isInst).toBe(true);
  expect(inst.instCount).toBe(4);
  expect(inst.firstX).toBeCloseTo(0, 4);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-instance-on-points.png') });

  // ── 3) RealizeInstances bakes the InstancedMesh. ──────────────────
  const realize = await win.evaluate(({ uuid, srcVerts }) => {
    const r = window.__studioGN2RealizeInstances(uuid);
    if (!r.ok) return r;
    const obj = window.__archdiscScene.getObjectByProperty('uuid', r.uuid);
    const verts = obj && obj.geometry ? obj.geometry.attributes.position.count : 0;
    const isInst = !!(obj && obj.isInstancedMesh);
    return { ok: r.ok, uuid: r.uuid, verts, isInst, expected: srcVerts * 4 };
  }, { uuid: inst.uuid, srcVerts: seed.verts });
  console.log('[gn2] realize', JSON.stringify(realize));
  expect(realize.ok).toBe(true);
  expect(realize.isInst).toBe(false);
  expect(realize.verts).toBe(realize.expected);

  // ── 4) TransformGeometry bakes a translate(2,0,0). ────────────────
  const xf = await win.evaluate(() => {
    const THREE = window.THREE;
    const geom = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x99cc66 });
    const m = new THREE.Mesh(geom, mat);
    m.userData.archdiscStudioPrimitive = true;
    m.userData.archdiscStudioPrimitiveKind = 'cube';
    window.__archdiscScene.add(m);
    const pos0 = m.geometry.attributes.position.getX(0);
    const T = new THREE.Matrix4().makeTranslation(2, 0, 0);
    const r = window.__studioGN2TransformGeometry(m.uuid, T.toArray());
    const pos1 = m.geometry.attributes.position.getX(0);
    return {
      r,
      pos0,
      pos1,
      meshX: m.position.x, meshY: m.position.y, meshZ: m.position.z,
    };
  });
  console.log('[gn2] transformGeometry', JSON.stringify(xf));
  expect(xf.r.ok).toBe(true);
  expect(xf.pos1 - xf.pos0).toBeCloseTo(2, 4);
  // mesh.position must stay at identity — the transform is in the buffer.
  expect(xf.meshX).toBe(0);
  expect(xf.meshY).toBe(0);
  expect(xf.meshZ).toBe(0);

  // ── 5) Subdivide raises vertex count. ─────────────────────────────
  const sub = await win.evaluate(() => {
    const THREE = window.THREE;
    const geom = new THREE.IcosahedronGeometry(0.5, 0);
    const m = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0xddaa66 }));
    m.userData.archdiscStudioPrimitive = true;
    window.__archdiscScene.add(m);
    const before = m.geometry.attributes.position.count;
    const r = window.__studioGN2Subdivide(m.uuid, 1);
    const after = m.geometry.attributes.position.count;
    return { r, before, after };
  });
  console.log('[gn2] subdivide', JSON.stringify(sub));
  expect(sub.r.ok).toBe(true);
  expect(sub.after).toBeGreaterThan(sub.before);

  // ── 6) MergeByDistance on a duplicated-vert cube. ─────────────────
  // We stack TWO BoxGeometry's worth of positions into one geometry —
  // every position has a literal duplicate at the same location, so
  // mergeByDistance must collapse them and report mergedVerts > 0.
  const merge = await win.evaluate(() => {
    const THREE = window.THREE;
    const a = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1).toNonIndexed();
    const aPos = a.attributes.position.array;
    const dup = new Float32Array(aPos.length * 2);
    dup.set(aPos, 0);
    dup.set(aPos, aPos.length);
    const idx = [];
    const triCount = (aPos.length / 3) / 3;
    for (let i = 0; i < triCount; i++) {
      idx.push(i * 3, i * 3 + 1, i * 3 + 2);
    }
    // Add the duplicate set of triangles too, all pointing at the
    // duplicated half of the position array.
    const offset = aPos.length / 3;
    for (let i = 0; i < triCount; i++) {
      idx.push(offset + i * 3, offset + i * 3 + 1, offset + i * 3 + 2);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(dup, 3));
    geom.setIndex(idx);
    const m = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0x6688cc }));
    m.userData.archdiscStudioPrimitive = true;
    window.__archdiscScene.add(m);
    const before = m.geometry.attributes.position.count;
    const r = window.__studioGN2MergeByDistance(m.uuid, 1e-4);
    const after = m.geometry.attributes.position.count;
    return { r, before, after };
  });
  console.log('[gn2] mergeByDistance', JSON.stringify(merge));
  expect(merge.r.ok).toBe(true);
  expect(merge.r.mergedVerts).toBeGreaterThan(0);
  expect(merge.after).toBeLessThan(merge.before);

  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-all-ops.png') });

  // ── 7) Camera sweep. ──────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport;
      const c = vp && vp.camera;
      if (c) {
        if (v === 'front') c.position.set(0, 0, 8);
        else if (v === 'top') c.position.set(0, 8, 0.001);
        else if (v === 'right') c.position.set(8, 0, 0);
        else if (v === 'iso') c.position.set(5, 5, 5);
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

  // eslint-disable-next-line no-console
  console.log('  slice 757: inst.count=%d, realize.verts=%d, sub %d→%d, merge -%d',
    inst.count, realize.verts, sub.before, sub.after, merge.r.mergedVerts);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
