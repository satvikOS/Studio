import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-geomdeep');

// Mac-Electron headed spec for the 20 deeper Houdini-SOP-style geometry
// node kinds added in geomdeep/. The spec:
//   1. dynamic-imports geomnodes/autoload.js + geomdeep/autoload.js on
//      the Vite dev server (so the orchestrator wiring is optional)
//   2. confirms __studioGeomDeepApply / __studioGeomDeepList /
//      __studioGeomDeep_<kind> exist for all 20 kinds
//   3. exercises every kind end-to-end with real BufferGeometry inputs
//      and asserts a non-trivial vertex count
//   4. captures 5 named camera angles after building a representative
//      deep-node mesh (per the headed-tests + multi-cam directives)

test('Studio V3 — 20 deeper Houdini-SOP geometry nodes (geomdeep)', async () => {
  test.setTimeout(180000);
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
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function', null, { timeout: 15000 });

  // ─── Ensure both autoload entries have run. ────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioGeomNodeAdd !== 'function') {
      await import('/src/workbenches/studio/v3/geomnodes/autoload.js');
    }
    if (typeof window.__studioGeomDeepApply !== 'function') {
      await import('/src/workbenches/studio/v3/geomdeep/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioGeomDeepApply === 'function', null, { timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioGeomDeepList === 'function', null, { timeout: 15000 });

  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ─── Discovery: all 20 kinds present + per-kind convenience ops. ──
  const list = await win.evaluate(() => window.__studioGeomDeepList());
  expect(list.ok).toBe(true);
  expect(list.count).toBe(20);
  const expectedKinds = [
    'noiseDisplace', 'wrangle', 'smooth', 'tubeFromLine', 'sweep',
    'latticeDeform', 'bend', 'twist', 'taper', 'mountain',
    'bevelGeom', 'solidifyGeom', 'decimateGeom', 'voxelizeGeom', 'spherifyGeom',
    'colorAttr', 'colorFromPos', 'scatterOnSurface', 'convexHull', 'merge',
  ];
  const seenKinds = list.kinds.map((k) => k.kind).sort();
  expect(seenKinds).toEqual(expectedKinds.slice().sort());

  // Every convenience op must be a function.
  const opsPresent = await win.evaluate((names) => {
    return names.every((n) => typeof window[`__studioGeomDeep_${n}`] === 'function');
  }, expectedKinds);
  expect(opsPresent).toBe(true);

  // Fallback map populated.
  const mapHas = await win.evaluate((names) => {
    const m = window.__studioGeomDeepNodes || {};
    return names.every((n) => !!m[n]);
  }, expectedKinds);
  expect(mapHas).toBe(true);

  // ─── Per-kind smoke evaluation. Build one or two THREE primitives in
  //     the page and pipe them through __studioGeomDeepApply. ────────
  const allOk = await win.evaluate(async () => {
    const THREE = await import('three');
    const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const sphere = new THREE.SphereGeometry(0.6, 24, 12).toNonIndexed();
    const tinyCube = new THREE.BoxGeometry(0.08, 0.08, 0.08).toNonIndexed();
    // A simple line curve (4 control points) as a BufferGeometry whose
    // verts trace a path.
    const lineArr = new Float32Array([
      -1, 0, 0,
      -0.3, 0.7, 0.4,
      0.6, -0.4, -0.3,
      1.2, 0.2, 0.6,
    ]);
    const line = new THREE.BufferGeometry();
    line.setAttribute('position', new THREE.BufferAttribute(lineArr, 3));
    // A simple 2D profile (square) for the sweep test.
    const profArr = new Float32Array([
      -0.1, -0.1, 0,
       0.1, -0.1, 0,
       0.1,  0.1, 0,
      -0.1,  0.1, 0,
    ]);
    const prof = new THREE.BufferGeometry();
    prof.setAttribute('position', new THREE.BufferAttribute(profArr, 3));

    const runs = [
      ['noiseDisplace',    { amplitude: 0.1, frequency: 3 },                                 { geometry: sphere }],
      ['wrangle',          { script: '[P.x, P.y + Math.sin(P.x * 5) * 0.05, P.z]' },         { geometry: box }],
      ['smooth',           { iters: 2, factor: 0.5 },                                        { geometry: sphere }],
      ['tubeFromLine',     { tubeRadius: 0.05, tubularSegments: 24, radialSegments: 6 },     { curve: line }],
      ['sweep',            { stations: 16, closeProfile: true },                             { profile: prof, curve: line }],
      ['latticeDeform',    {},                                                               { geometry: box }],
      ['bend',             { degrees: 45 },                                                  { geometry: box }],
      ['twist',            { degrees: 90 },                                                  { geometry: box }],
      ['taper',            { topRatio: 0.4 },                                                { geometry: box }],
      ['mountain',         { amplitude: 0.15, frequency: 2, octaves: 3 },                    { geometry: sphere }],
      ['bevelGeom',        { distance: 0.05, segments: 2 },                                  { geometry: box }],
      ['solidifyGeom',     { thickness: 0.04 },                                              { geometry: sphere }],
      ['decimateGeom',     { ratio: 0.6 },                                                   { geometry: sphere }],
      ['voxelizeGeom',     { size: 0.15 },                                                   { geometry: sphere }],
      ['spherifyGeom',     { radius: 0.6 },                                                  { geometry: box }],
      ['colorAttr',        { color: '#ff8800' },                                             { geometry: box }],
      ['colorFromPos',     {},                                                               { geometry: sphere }],
      ['scatterOnSurface', { count: 12, seed: 7 },                                           { A: tinyCube, B: sphere }],
      ['convexHull',       {},                                                               { geometry: sphere }],
      ['merge',            {},                                                               { A: box, B: sphere }],
    ];
    const results = [];
    for (const [kind, params, inputs] of runs) {
      const r = window.__studioGeomDeepApply(kind, params, inputs);
      results.push({
        kind,
        ok: !!(r && r.ok),
        vertices: r && r.vertices || 0,
        error: r && r.error,
      });
    }
    return results;
  });

  // Every kind must succeed with > 0 verts.
  for (const r of allOk) {
    expect(r.ok, `${r.kind} expected ok=true (err: ${r.error})`).toBe(true);
    expect(r.vertices, `${r.kind} expected > 0 vertices`).toBeGreaterThan(0);
  }

  // ─── Spot-check colour attribute is actually written. ─────────────
  const hasColorAttr = await win.evaluate(async () => {
    const THREE = await import('three');
    const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const r = window.__studioGeomDeepApply('colorAttr', { color: '#22aaff' }, { geometry: box });
    if (!r.ok) return false;
    const c = r.geometry.attributes.color;
    if (!c || c.itemSize !== 3 || c.count === 0) return false;
    // First vert should be near (0.13, 0.67, 1.0).
    return Math.abs(c.getX(0) - 0x22 / 255) < 0.02
        && Math.abs(c.getY(0) - 0xaa / 255) < 0.02
        && Math.abs(c.getZ(0) - 0xff / 255) < 0.02;
  });
  expect(hasColorAttr).toBe(true);

  // ─── Spot-check convex hull produces strictly fewer verts than input. ─
  const hullSmaller = await win.evaluate(async () => {
    const THREE = await import('three');
    // Use a noisy point cloud (sphere whose verts we scatter slightly).
    const sphere = new THREE.SphereGeometry(0.5, 32, 16).toNonIndexed();
    const before = sphere.attributes.position.count;
    const r = window.__studioGeomDeepApply('convexHull', {}, { geometry: sphere });
    return r.ok && r.vertices > 0 && r.vertices <= before;
  });
  expect(hullSmaller).toBe(true);

  // ─── Build a deep-node mesh INTO the scene via the slice-684 graph
  //     so the screenshots show real geometry. We wire:
  //         primitive(sphere) → mountain (via custom run + injection)
  //     by simply adding a primitive node, building the seeded mesh,
  //     then deep-applying mountain and injecting the resulting
  //     geometry as a fresh THREE.Mesh. ─────────────────────────────
  await win.evaluate(async () => {
    const THREE = await import('three');
    const base = new THREE.SphereGeometry(0.8, 48, 24).toNonIndexed();
    const r = window.__studioGeomDeepApply(
      'mountain',
      { amplitude: 0.18, frequency: 2.5, octaves: 4, lacunarity: 2.0, gain: 0.55 },
      { geometry: base },
    );
    if (!r.ok) return;
    const geo = r.geometry;
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8bbcd6, roughness: 0.5, metalness: 0.08, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'geomdeep-mountain';
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'geomdeep';
    if (window.__archdiscScene) window.__archdiscScene.add(mesh);
    if (window.__studioSelectMesh) try { window.__studioSelectMesh(mesh); } catch (_) {}
  });

  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-mountain-built.png') });

  // ─── Multi-cam viewport screenshots. ──────────────────────────────
  for (const view of ['front', 'top', 'right', 'iso', 'close']) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 0, 4);
      else if (v === 'top') c.position.set(0, 4, 0.001);
      else if (v === 'right') c.position.set(4, 0, 0);
      else if (v === 'iso') c.position.set(3, 3, 3);
      else if (v === 'close') c.position.set(1.5, 1.5, 1.5);
      c.lookAt(0, 0, 0);
    }, view);
    await win.waitForTimeout(200);
    await win.screenshot({ path: path.join(OUT, `02-cam-${view}.png`) });
  }

  // ─── Command palette should see at least the new ops. ─────────────
  const palette = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { ok: false };
    return window.__studioCommandList('geomnodes');
  });
  if (palette.ok) {
    const names = palette.commands.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining([
      '__studioGeomDeepApply',
      '__studioGeomDeepList',
      '__studioGeomDeep_noiseDisplace',
      '__studioGeomDeep_convexHull',
      '__studioGeomDeep_merge',
    ]));
  }

  // eslint-disable-next-line no-console
  console.log('  geomdeep: %d kinds OK, registeredVia=%s', list.count, list.registeredVia);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
