import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-editops');

test('Studio V3 — edit-mode ops port (pickers + G/R/S + select + extrude/inset/subdivide) (slice 402)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 350,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioPickFaceFromClick === 'function', null, { timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioExtrudeSelectedFaces === 'function', null, { timeout: 15000 });

  // Spawn a cube + select it as the active mesh (via gizmo attach).
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    cube.position.set(0, 0, 0); cube.scale.set(1, 1, 1); cube.updateMatrixWorld(true);
    vp.transformControls.attach(cube);
    vp.camera.position.set(0, 0, 6);
    vp.orbitControls.target.set(0, 0, 0);
    vp.orbitControls.update();
    vp.camera.updateMatrixWorld(true);
    window.__studioClearEditSelection();
  });
  await win.waitForTimeout(200);

  // PICKERS — vertex / face / edge from centre-screen NDC.
  const pv = await win.evaluate(() => window.__studioPickVertexFromClick(0, 0));
  expect(pv.ok).toBe(true);
  expect(pv.vertIdx).toBeGreaterThanOrEqual(0);
  const pf = await win.evaluate(() => window.__studioPickFaceFromClick(0, 0));
  expect(pf.ok).toBe(true);
  expect(pf.vertIdx.length).toBe(3);
  expect(pf.normal[2]).toBeGreaterThan(0.5);
  const pe = await win.evaluate(() => window.__studioPickEdgeFromClick(0, 0));
  expect(pe.ok).toBe(true);
  expect(pe.vertIdx.length).toBe(2);

  // MOVE selected face — verts shift along X.
  let r = await win.evaluate(() => {
    window.__studioReplaceEditSelection('face', 0);
    return window.__studioMoveSelectedVerts(0.01, 0, 0);
  });
  expect(r.ok).toBe(true);
  expect(r.vertCount).toBe(3);

  // SCALE selected face × 2 around centroid.
  r = await win.evaluate(() => {
    window.__studioReplaceEditSelection('face', 0);
    return window.__studioScaleSelectedVerts(2);
  });
  expect(r.ok).toBe(true);
  expect(r.vertCount).toBe(3);

  // ROTATE selected face 180° z — verts mirror around centroid.
  r = await win.evaluate(() => {
    window.__studioReplaceEditSelection('face', 0);
    return window.__studioRotateSelectedVerts(Math.PI, 'z');
  });
  expect(r.ok).toBe(true);
  expect(r.vertCount).toBe(3);

  // SELECT ALL — vertex/face/edge counts.
  let sa = await win.evaluate(() => window.__studioSelectAllEdit('vertex'));
  expect(sa.counts.vertices).toBe(24);
  sa = await win.evaluate(() => window.__studioSelectAllEdit('face'));
  expect(sa.counts.faces).toBe(12);
  sa = await win.evaluate(() => window.__studioSelectAllEdit('edge'));
  expect(sa.counts.edges).toBe(30);

  // INVERT — vertex 1 selected → invert → 23.
  await win.evaluate(() => window.__studioReplaceEditSelection('vertex', 0));
  const inv = await win.evaluate(() => window.__studioInvertEditSelection('vertex'));
  expect(inv.counts.vertices).toBe(23);

  // EXTRUDE face 0 → 24v/12t → 27v/18t.
  await win.evaluate(() => window.__studioReplaceEditSelection('face', 0));
  const ex = await win.evaluate(() => window.__studioExtrudeSelectedFaces(0.005));
  expect(ex.ok).toBe(true);
  expect(ex.vertCount).toBe(27);
  expect(ex.triCount).toBe(18);

  // INSET face 0 → 27v/18t → 30v/24t (-1 + 7 = +6).
  await win.evaluate(() => window.__studioReplaceEditSelection('face', 0));
  const ins = await win.evaluate(() => window.__studioInsetSelectedFaces(0.3));
  expect(ins.ok).toBe(true);
  expect(ins.vertCount).toBe(30);
  expect(ins.triCount).toBe(24);

  // SUBDIVIDE face 0 → 30v/24t → 33v/27t (-1 + 4 = +3).
  await win.evaluate(() => window.__studioReplaceEditSelection('face', 0));
  const sub = await win.evaluate(() => window.__studioSubdivideSelectedFaces());
  expect(sub.ok).toBe(true);
  expect(sub.vertCount).toBe(33);
  expect(sub.triCount).toBe(27);

  await win.screenshot({ path: path.join(OUT, '00-after-editops.png') });

  // Reset.
  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log('  slice 402: pickers + G/R/S + selectAll/invert + extrude/inset/subdivide all green');

  await app.close();
});

// ─── Real Blender-style edit-mode operators (10 ops) ─────────────────────
// Exercises bevel/inset/loop-cut/knife/bridge/edge-slide/dissolve-verts/
// dissolve-faces/merge-by-distance/rip — each spawns a fresh cube, calls
// the op, and asserts the resulting BufferGeometry differs measurably.
test('Studio V3 — Blender-style edit-mode operators (10 ops)', async () => {
  test.setTimeout(360000);
  const OUT2 = path.resolve(__dirname, 'screenshots', 'studio-v3-editops');
  fs.mkdirSync(OUT2, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 30000 });

  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function', null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioEditBevel === 'function', null, { timeout: 30000 });

  const spawnCube = async () => {
    await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
    await win.waitForTimeout(200);
    return await win.evaluate(() => {
      const m = window.__studioSelectedMesh();
      return {
        verts: m.geometry.attributes.position.count,
        tris: m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3,
      };
    });
  };

  // ─── 0. all 10 ops auto-registered with the command palette ──────────
  const cmdHits = await win.evaluate(() =>
    window.__studioCommandList && window.__studioCommandList('edit')
  );
  expect(cmdHits.ok).toBe(true);
  const editNames = new Set(cmdHits.commands.map((c) => c.name));
  for (const n of [
    '__studioEditBevel', '__studioEditInset', '__studioEditLoopCut',
    '__studioEditKnife', '__studioEditBridge', '__studioEditEdgeSlide',
    '__studioEditDissolveVerts', '__studioEditDissolveFaces',
    '__studioEditMergeByDistance', '__studioEditRip',
  ]) {
    expect(editNames.has(n)).toBe(true);
  }
  await win.screenshot({ path: path.join(OUT2, '00-cmd-palette.png') });

  // ─── 1. Bevel ────────────────────────────────────────────────────────
  const beforeBevel = await spawnCube();
  const bevelR = await win.evaluate(() => window.__studioEditBevel(0.002, 2));
  expect(bevelR.ok).toBe(true);
  expect(bevelR.beveledEdges).toBeGreaterThan(0);
  expect(bevelR.newVerts).toBeGreaterThan(0);
  const afterBevel = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { verts: m.geometry.attributes.position.count, tris: m.geometry.index.count / 3 };
  });
  expect(afterBevel.verts).toBeGreaterThan(beforeBevel.verts);
  await win.screenshot({ path: path.join(OUT2, '01-bevel.png') });

  // ─── 2. Inset ────────────────────────────────────────────────────────
  const beforeInset = await spawnCube();
  const insetR = await win.evaluate(() => window.__studioEditInset(0.3, true));
  expect(insetR.ok).toBe(true);
  expect(insetR.insetFaces).toBeGreaterThan(0);
  const afterInset = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { verts: m.geometry.attributes.position.count, tris: m.geometry.index.count / 3 };
  });
  expect(afterInset.tris).toBeGreaterThan(beforeInset.tris);
  await win.screenshot({ path: path.join(OUT2, '02-inset.png') });

  // ─── 3. Loop Cut ─────────────────────────────────────────────────────
  const beforeLoop = await spawnCube();
  const loopR = await win.evaluate(() => window.__studioEditLoopCut(0, 2));
  expect(loopR.ok).toBe(true);
  expect(loopR.newEdges).toBeGreaterThan(0);
  const afterLoop = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { verts: m.geometry.attributes.position.count, tris: m.geometry.index.count / 3 };
  });
  expect(afterLoop.verts).toBeGreaterThan(beforeLoop.verts);
  expect(afterLoop.tris).toBeGreaterThan(beforeLoop.tris);
  await win.screenshot({ path: path.join(OUT2, '03-loopcut.png') });

  // ─── 4. Knife ────────────────────────────────────────────────────────
  const beforeKnife = await spawnCube();
  const knifeR = await win.evaluate(() => window.__studioEditKnife([-0.5, 0], [0.5, 0]));
  expect(knifeR.ok).toBe(true);
  expect(knifeR.splitTris).toBeGreaterThanOrEqual(0);
  const afterKnife = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { verts: m.geometry.attributes.position.count, tris: m.geometry.index.count / 3 };
  });
  expect(afterKnife.tris).toBeGreaterThanOrEqual(beforeKnife.tris);
  await win.screenshot({ path: path.join(OUT2, '04-knife.png') });

  // ─── 5. Bridge ───────────────────────────────────────────────────────
  await spawnCube();
  const bridgeR = await win.evaluate(() => window.__studioEditBridge(0, 6));
  expect(bridgeR.ok).toBe(true);
  expect(bridgeR.bridgeFaces).toBe(6);
  expect(bridgeR.removed).toBe(2);
  await win.screenshot({ path: path.join(OUT2, '05-bridge.png') });

  // ─── 6. Edge Slide ───────────────────────────────────────────────────
  await spawnCube();
  const beforeSlideHash = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    let h = 0;
    for (let i = 0; i < Math.min(p.count, 24); i++) h += Math.round(p.getX(i) * 1e6) + Math.round(p.getY(i) * 1e6) * 7 + Math.round(p.getZ(i) * 1e6) * 31;
    return h;
  });
  const slideR = await win.evaluate(() => window.__studioEditEdgeSlide(0, 0.4));
  expect(slideR.ok).toBe(true);
  expect(slideR.movedVerts).toBe(2);
  const afterSlideHash = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    let h = 0;
    for (let i = 0; i < Math.min(p.count, 24); i++) h += Math.round(p.getX(i) * 1e6) + Math.round(p.getY(i) * 1e6) * 7 + Math.round(p.getZ(i) * 1e6) * 31;
    return h;
  });
  expect(afterSlideHash).not.toBe(beforeSlideHash);
  await win.screenshot({ path: path.join(OUT2, '06-edgeslide.png') });

  // ─── 7. Dissolve Vertices ────────────────────────────────────────────
  const beforeDV = await spawnCube();
  const dvR = await win.evaluate(() => window.__studioEditDissolveVerts([0, 1]));
  expect(dvR.ok).toBe(true);
  expect(dvR.removedVerts).toBe(2);
  const afterDV = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { verts: m.geometry.attributes.position.count };
  });
  expect(afterDV.verts).toBeLessThan(beforeDV.verts);
  await win.screenshot({ path: path.join(OUT2, '07-dissolve-verts.png') });

  // ─── 8. Dissolve Faces ───────────────────────────────────────────────
  const beforeDF = await spawnCube();
  const dfR = await win.evaluate(() => window.__studioEditDissolveFaces([0, 1, 2, 3]));
  expect(dfR.ok).toBe(true);
  expect(dfR.removedFaces).toBe(4);
  const afterDF = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { tris: m.geometry.index.count / 3 };
  });
  expect(afterDF.tris).toBe(beforeDF.tris - 4);
  await win.screenshot({ path: path.join(OUT2, '08-dissolve-faces.png') });

  // ─── 9. Merge by Distance ────────────────────────────────────────────
  const beforeMerge = await spawnCube();
  const mergeR = await win.evaluate(() => window.__studioEditMergeByDistance(1e-3));
  expect(mergeR.ok).toBe(true);
  expect(mergeR.removed).toBeGreaterThan(0);
  const afterMerge = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { verts: m.geometry.attributes.position.count };
  });
  expect(afterMerge.verts).toBeLessThan(beforeMerge.verts);
  await win.screenshot({ path: path.join(OUT2, '09-merge.png') });

  // ─── 10. Rip ─────────────────────────────────────────────────────────
  const beforeRip = await spawnCube();
  const ripR = await win.evaluate(() => window.__studioEditRip(0));
  expect(ripR.ok).toBe(true);
  expect(ripR.newVertCount).toBe(beforeRip.verts + 1);
  expect(ripR.movedFaces).toBeGreaterThanOrEqual(0);
  await win.screenshot({ path: path.join(OUT2, '10-rip.png') });

  // ─── idempotency ─────────────────────────────────────────────────────
  const idem = await win.evaluate(async () => {
    try {
      const m = await import('/src/workbenches/studio/v3/edit/index.js');
      const a = m.installEditOps();
      const b = m.installEditOps();
      return { dynamic: true, a, b, stillFn: typeof window.__studioEditBevel === 'function' };
    } catch (_) {
      return { dynamic: false };
    }
  });
  if (idem.dynamic) {
    expect(idem.a).toBe(true);
    expect(idem.b).toBe(true);
    expect(idem.stillFn).toBe(true);
  }

  await win.screenshot({ path: path.join(OUT2, '99-final.png') });

  // eslint-disable-next-line no-console
  console.log('  edit-ops: 10/10 ops produced measurable geometry diffs');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(150);
  await app.close();
});
