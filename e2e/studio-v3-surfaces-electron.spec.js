// Studio V3 — Plasticity-style surface ops (fillet / chamfer / offset /
// shell / unfold / stitch). Drives the surface op family installed by
// frontend/src/workbenches/studio/v3/surfaces/autoload.js.
//
// Because this slice can't touch api.js, the test side-effect-imports
// the autoload itself via the dev-server URL — same trick the
// editmore / shader / anim e2es use.
//
// Coverage:
//   - All 9 ops auto-register under the "edit" category in the palette.
//   - Each op yields a measurably different BufferGeometry (vert / tri
//     count, or new mesh uuid).
//   - The SurfacePanel mounts + the Apply button drives an op end-to-end.
//   - Multi-cam screenshots (front / top / right / iso / close) so the
//     remote-desktop watcher can verify the result.
//   - Re-invocation of installSurfaces() is idempotent.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-surfaces');

const OP_NAMES = [
  '__studioSurfaceFilletEdge',
  '__studioSurfaceChamferEdge',
  '__studioSurfaceOffset',
  '__studioSurfaceShell',
  '__studioSurfaceUnfold',
  '__studioSurfaceStitch',
  '__studioSurfacePanelOpen',
  '__studioSurfacePanelClose',
  '__studioSurfacePanelToggle',
];

test('Studio V3 — surfaces: Plasticity-style fillet/chamfer/offset/shell/unfold/stitch', async () => {
  test.setTimeout(420000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
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

  // ─── Side-effect-import the autoload so the surface op surface lights up.
  await win.evaluate(async () => {
    if (typeof window.__studioSurfaceFilletEdge !== 'function') {
      await import('/src/workbenches/studio/v3/surfaces/autoload.js');
    }
  });
  await win.waitForFunction(
    (names) => names.every((n) => typeof window[n] === 'function'),
    OP_NAMES,
    { timeout: 15000 },
  );

  // Helper: spawn a fresh cube and return its uuid + counts.
  const spawnCube = async () => {
    await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
    await win.waitForTimeout(220);
    return await win.evaluate(() => {
      const vp = window.__archdiscViewport;
      let cube = null;
      vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
      cube.position.set(0, 0, 0); cube.scale.set(1, 1, 1); cube.updateMatrixWorld(true);
      vp.transformControls.attach(cube);
      vp.camera.position.set(2.5, 2.5, 3);
      vp.camera.lookAt(0, 0, 0);
      vp.orbitControls.target.set(0, 0, 0);
      vp.orbitControls.update();
      vp.camera.updateMatrixWorld(true);
      const g = cube.geometry;
      return {
        uuid: cube.uuid,
        verts: g.attributes.position.count,
        tris: g.index ? g.index.count / 3 : g.attributes.position.count / 3,
      };
    });
  };

  const meshStats = (uuid) => win.evaluate((u) => {
    const vp = window.__archdiscViewport; if (!vp) return null;
    let m = null;
    vp.scene.traverse((o) => { if (o.uuid === u) m = o; });
    if (!m || !m.geometry) return null;
    return {
      verts: m.geometry.attributes.position.count,
      tris: m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3,
    };
  }, uuid);

  // ─── 0. All ops auto-registered under "edit" ───────────────────────────
  const cmdList = await win.evaluate(() => window.__studioCommandList && window.__studioCommandList('edit'));
  expect(cmdList && cmdList.ok).toBe(true);
  const names = new Set(cmdList.commands.map((c) => c.name));
  for (const n of OP_NAMES) expect(names.has(n)).toBe(true);
  await win.screenshot({ path: path.join(OUT, '00-cmd-palette.png') });

  // ─── 1. Fillet edge ────────────────────────────────────────────────────
  const beforeFi = await spawnCube();
  const fiR = await win.evaluate((args) => {
    // BoxGeometry packs each face as 2 tris sharing a diagonal edge:
    // tri0 = (a, b, c), tri1 = (b, d, c). The shared edge is (b, c) —
    // i.e. idx[1] and idx[2] of tri 0. Pick that so the fillet finds
    // both adjacent faces.
    const m = window.__studioSelectedMesh();
    const idx = m.geometry.index;
    const va = Math.min(idx.getX(1), idx.getX(2));
    const vb = Math.max(idx.getX(1), idx.getX(2));
    const ek = `${va}_${vb}`;
    return window.__studioSurfaceFilletEdge(args.uuid, ek, 0.08, 4);
  }, { uuid: beforeFi.uuid });
  expect(fiR.ok).toBe(true);
  expect(fiR.addedTris).toBeGreaterThan(0);
  const afterFi = await meshStats(beforeFi.uuid);
  expect(afterFi.verts).toBeGreaterThan(beforeFi.verts);
  expect(afterFi.tris).toBeGreaterThan(beforeFi.tris - 2);
  await win.screenshot({ path: path.join(OUT, '01-fillet.png') });

  // ─── 2. Chamfer edge ───────────────────────────────────────────────────
  const beforeCh = await spawnCube();
  const chR = await win.evaluate((args) => {
    const m = window.__studioSelectedMesh();
    const idx = m.geometry.index;
    // Shared diagonal between cube face's 2 tris — see fillet note.
    const va = Math.min(idx.getX(1), idx.getX(2));
    const vb = Math.max(idx.getX(1), idx.getX(2));
    const ek = `${va}_${vb}`;
    return window.__studioSurfaceChamferEdge(args.uuid, ek, 0.1);
  }, { uuid: beforeCh.uuid });
  expect(chR.ok).toBe(true);
  expect(chR.addedTris).toBe(4);
  const afterCh = await meshStats(beforeCh.uuid);
  expect(afterCh.verts).toBe(beforeCh.verts + 4);
  await win.screenshot({ path: path.join(OUT, '02-chamfer.png') });

  // ─── 3. Offset surface ─────────────────────────────────────────────────
  const beforeOff = await spawnCube();
  const offR = await win.evaluate((args) => window.__studioSurfaceOffset(args.uuid, 0.2),
    { uuid: beforeOff.uuid });
  expect(offR.ok).toBe(true);
  expect(typeof offR.uuid).toBe('string');
  expect(offR.uuid).not.toBe(beforeOff.uuid);
  expect(offR.verts).toBe(beforeOff.verts);
  // Source mesh still present + unchanged.
  const sourceStill = await win.evaluate((u) => {
    const vp = window.__archdiscViewport; let f = false;
    vp.scene.traverse((o) => { if (o.uuid === u) f = true; });
    return f;
  }, beforeOff.uuid);
  expect(sourceStill).toBe(true);
  // New offset mesh exists.
  const offFound = await win.evaluate((u) => {
    const vp = window.__archdiscViewport; let f = false;
    vp.scene.traverse((o) => { if (o.uuid === u) f = true; });
    return f;
  }, offR.uuid);
  expect(offFound).toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-offset.png') });

  // ─── 4. Shell ──────────────────────────────────────────────────────────
  const beforeSh = await spawnCube();
  const shR = await win.evaluate((args) => window.__studioSurfaceShell(args.uuid, 0.15),
    { uuid: beforeSh.uuid });
  expect(shR.ok).toBe(true);
  expect(typeof shR.uuid).toBe('string');
  // Shell verts = 2 × source verts.
  expect(shR.verts).toBe(beforeSh.verts * 2);
  // Shell tris >= 2 × source tris (walls only kick in for open meshes,
  // but the outer + flipped-inner double the tri count anyway).
  expect(shR.tris).toBeGreaterThanOrEqual(beforeSh.tris * 2);
  await win.screenshot({ path: path.join(OUT, '04-shell.png') });

  // ─── 5. Unfold strip ───────────────────────────────────────────────────
  const beforeUn = await spawnCube();
  // Cube has 12 tris — pick a connected strip of 4 (two adjacent faces × 2 tris).
  const unR = await win.evaluate((args) => window.__studioSurfaceUnfold(args.uuid, [0, 1, 2, 3]),
    { uuid: beforeUn.uuid });
  expect(unR.ok).toBe(true);
  expect(unR.faceCount).toBeGreaterThanOrEqual(1);
  expect(typeof unR.uuid).toBe('string');
  // The unfolded mesh should have z≈0 for every vert (it's flat in XY).
  const flat = await win.evaluate((u) => {
    const vp = window.__archdiscViewport; let m = null;
    vp.scene.traverse((o) => { if (o.uuid === u) m = o; });
    if (!m) return null;
    const p = m.geometry.attributes.position;
    let maxZ = 0;
    for (let i = 0; i < p.count; i++) maxZ = Math.max(maxZ, Math.abs(p.getZ(i)));
    return { count: p.count, maxZ };
  }, unR.uuid);
  expect(flat.count).toBeGreaterThan(2);
  expect(flat.maxZ).toBeLessThan(1e-3);
  await win.screenshot({ path: path.join(OUT, '05-unfold.png') });

  // ─── 6. Stitch loops ───────────────────────────────────────────────────
  // Spawn two cubes; stitch a boundary loop of each. Both are closed
  // meshes so the stitch op needs explicit loops — we feed indices for
  // one face of each cube (3 verts).
  const cubeA = await spawnCube();
  const cubeB = await spawnCube();
  // Move B aside so the bridge has length.
  await win.evaluate((u) => {
    const vp = window.__archdiscViewport;
    vp.scene.traverse((o) => { if (o.uuid === u) { o.position.set(1.5, 0, 0); o.updateMatrixWorld(true); } });
  }, cubeB.uuid);
  const stR = await win.evaluate((args) => {
    const vp = window.__archdiscViewport;
    let mA = null, mB = null;
    vp.scene.traverse((o) => { if (o.uuid === args.a) mA = o; if (o.uuid === args.b) mB = o; });
    const lA = [mA.geometry.index.getX(0), mA.geometry.index.getX(1), mA.geometry.index.getX(2)];
    const lB = [mB.geometry.index.getX(0), mB.geometry.index.getX(1), mB.geometry.index.getX(2)];
    return window.__studioSurfaceStitch(args.a, lA, args.b, lB);
  }, { a: cubeA.uuid, b: cubeB.uuid });
  expect(stR.ok).toBe(true);
  expect(stR.pairs).toBeGreaterThanOrEqual(3);
  expect(stR.tris).toBeGreaterThanOrEqual(6);
  const stitchFound = await win.evaluate((u) => {
    const vp = window.__archdiscViewport; let f = false;
    vp.scene.traverse((o) => { if (o.uuid === u) f = true; });
    return f;
  }, stR.uuid);
  expect(stitchFound).toBe(true);
  await win.screenshot({ path: path.join(OUT, '06-stitch.png') });

  // ─── 7. SurfacePanel — open + apply via UI button ─────────────────────
  await spawnCube();
  await win.evaluate(() => window.__studioSurfacePanelOpen());
  await expect(win.locator('[data-studio-v3-surface-panel]')).toBeVisible({ timeout: 5000 });
  // The default op (fillet) requires an edge — switch to "offset" which
  // only needs the distance field. Then apply.
  await win.locator('[data-studio-v3-surface-op="offset"]').click();
  await win.waitForTimeout(80);
  await win.locator('[data-studio-v3-surface-apply]').click();
  await win.waitForTimeout(200);
  // Status string should show "ok"-prefixed text.
  const status = await win.locator('[data-studio-v3-surface-status]').innerText();
  expect(status.toLowerCase()).toContain('ok');
  await win.screenshot({ path: path.join(OUT, '07-panel.png') });
  await win.evaluate(() => window.__studioSurfacePanelClose());

  // ─── 8. Idempotency ────────────────────────────────────────────────────
  const idem = await win.evaluate(async () => {
    const mod = await import('/src/workbenches/studio/v3/surfaces/index.js');
    const a = mod.installSurfaces();
    const b = mod.installSurfaces();
    return {
      a: a && a.ok,
      b: b && b.ok,
      installedA: a && a.installed,
      stillFn: typeof window.__studioSurfaceFilletEdge === 'function',
      panelToggleFn: typeof window.__studioSurfacePanelToggle === 'function',
    };
  });
  expect(idem.a).toBe(true);
  expect(idem.b).toBe(true);
  expect(idem.installedA).toBe(9);
  expect(idem.stillFn).toBe(true);
  expect(idem.panelToggleFn).toBe(true);

  // ─── 9. Multi-cam screenshots ─────────────────────────────────────────
  // Spawn a cube + run shell so there's a visibly-shelled object to capture
  // from 5 named angles.
  const finalCube = await spawnCube();
  await win.evaluate((args) => window.__studioSurfaceShell(args.uuid, 0.2),
    { uuid: finalCube.uuid });
  await win.waitForTimeout(200);

  for (const view of ['front', 'top', 'right', 'iso', 'close']) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 0.5, 4);
      else if (v === 'top') c.position.set(0, 4.5, 0.01);
      else if (v === 'right') c.position.set(4, 0.5, 0);
      else if (v === 'iso') c.position.set(3, 3, 3);
      else if (v === 'close') c.position.set(1.2, 1.5, 1.8);
      c.lookAt(0, 0, 0);
      if (vp.orbitControls) { vp.orbitControls.target.set(0, 0, 0); vp.orbitControls.update(); }
      c.updateMatrixWorld(true);
    }, view);
    await win.waitForTimeout(180);
    await win.screenshot({ path: path.join(OUT, `99-cam-${view}.png`) });
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────
  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.waitForTimeout(120);

  // eslint-disable-next-line no-console
  console.log('  surfaces: 6/6 ops produced measurable geometry diffs + panel works');

  await app.close();
});
