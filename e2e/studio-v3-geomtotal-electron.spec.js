import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-geomtotal');

// Mac-Electron headed spec for the 30 additional Geometry-Node kinds
// added in geomtotal/. The spec:
//   1. dynamic-imports geomnodes/autoload.js, geomdeep/autoload.js and
//      geomtotal/autoload.js on the Vite dev server (so the orchestrator
//      wiring is optional)
//   2. confirms __studioGeomTotalApply / __studioGeomTotalList /
//      __studioGeomTotal_<kind> exist for all 30 kinds
//   3. exercises every kind end-to-end with real BufferGeometry inputs
//      and asserts a non-trivial vertex count
//   4. captures 5 named camera angles after building a representative
//      geomtotal mesh (per the headed-tests + multi-cam directives)

test('Studio V3 — 30 additional Geometry Nodes (geomtotal)', async () => {
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

  // ─── Ensure all three autoload entries have run. ────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioGeomNodeAdd !== 'function') {
      await import('/src/workbenches/studio/v3/geomnodes/autoload.js');
    }
    if (typeof window.__studioGeomDeepApply !== 'function') {
      await import('/src/workbenches/studio/v3/geomdeep/autoload.js');
    }
    if (typeof window.__studioGeomTotalApply !== 'function') {
      await import('/src/workbenches/studio/v3/geomtotal/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioGeomTotalApply === 'function', null, { timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioGeomTotalList === 'function', null, { timeout: 15000 });

  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ─── Discovery: all 30 kinds present + per-kind convenience ops. ──
  const list = await win.evaluate(() => window.__studioGeomTotalList());
  expect(list.ok).toBe(true);
  expect(list.count).toBe(30);
  const expectedKinds = [
    // 8 primitives
    'tetrahedron', 'octahedron', 'dodecahedron', 'capsule', 'ringTorus',
    'cylinderOpenEnded', 'frustum', 'pyramid',
    // 4 curves
    'spiral', 'helix', 'lineSegment', 'arcCircle',
    // 6 attribute math
    'setPositionAttr', 'capturePositionAttr', 'vectorMath',
    'dotProduct', 'length', 'mapRange',
    // 6 topology
    'edgeSplitByAngle', 'mergeByDistance', 'extrudeAlongNormal',
    'insetIndividual', 'faceWeightedNormal', 'recalculateNormals',
    // 3 distribution
    'pointsOnFaces', 'poissonDisk', 'gridPoints',
    // 3 sampling/filtering
    'sampleNearest', 'greaterThan', 'maskExtract',
  ];
  const seenKinds = list.kinds.map((k) => k.kind).sort();
  expect(seenKinds).toEqual(expectedKinds.slice().sort());

  // Every convenience op must be a function.
  const opsPresent = await win.evaluate((names) => {
    return names.every((n) => typeof window[`__studioGeomTotal_${n}`] === 'function');
  }, expectedKinds);
  expect(opsPresent).toBe(true);

  // Fallback map populated.
  const mapHas = await win.evaluate((names) => {
    const m = window.__studioGeomTotalNodes || {};
    return names.every((n) => !!m[n]);
  }, expectedKinds);
  expect(mapHas).toBe(true);

  // ─── Per-kind smoke evaluation. Build representative inputs in the
  //     page and pipe them through __studioGeomTotalApply. ────────────
  const allOk = await win.evaluate(async () => {
    const THREE = await import('three');
    const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const sphere = new THREE.SphereGeometry(0.6, 24, 12).toNonIndexed();
    const sphereSmall = new THREE.SphereGeometry(0.3, 12, 8).toNonIndexed();

    const runs = [
      // Primitive variants (no input).
      ['tetrahedron',         { radius: 0.5 },                                        {}],
      ['octahedron',          { radius: 0.5 },                                        {}],
      ['dodecahedron',        { radius: 0.6 },                                        {}],
      ['capsule',             { radius: 0.3, length: 0.6 },                           {}],
      ['ringTorus',           { majorRadius: 0.5, minorRadius: 0.15 },                {}],
      ['cylinderOpenEnded',   { radius: 0.4, height: 0.8 },                           {}],
      ['frustum',             { topRadius: 0.2, bottomRadius: 0.5, height: 0.8 },     {}],
      ['pyramid',             { baseRadius: 0.5, height: 0.8, sides: 4 },             {}],
      // Curves (no input).
      ['spiral',              { turns: 2, b: 0.1, tubeRadius: 0.03 },                 {}],
      ['helix',               { radius: 0.3, pitch: 0.2, turns: 3 },                  {}],
      ['lineSegment',         { from: [-0.8, 0, 0], to: [0.8, 0.2, 0] },              {}],
      ['arcCircle',           { radius: 0.5, startAngle: 0, endAngle: Math.PI * 1.5 }, {}],
      // Attribute math.
      ['setPositionAttr',     { attrName: 'capturedPos' },                            { geometry: box }],
      ['capturePositionAttr', { attrName: 'capturedPos' },                            { geometry: box }],
      ['vectorMath',          { op: 'add', b: [0.1, 0.05, 0] },                       { geometry: box }],
      ['dotProduct',          { b: [0, 1, 0], attrName: 'dot' },                      { geometry: sphere }],
      ['length',              { attrName: 'length' },                                 { geometry: sphere }],
      ['mapRange',            { attrName: 'foo', fromMin: -1, fromMax: 1, toMin: 0, toMax: 2 }, { geometry: box }],
      // Topology.
      ['edgeSplitByAngle',    { angleDeg: 30 },                                       { geometry: sphere }],
      ['mergeByDistance',     { distance: 0.01 },                                     { geometry: box }],
      ['extrudeAlongNormal',  { distance: 0.05 },                                     { geometry: sphere }],
      ['insetIndividual',     { amount: 0.25 },                                       { geometry: box }],
      ['faceWeightedNormal',  {},                                                     { geometry: sphere }],
      ['recalculateNormals',  {},                                                     { geometry: sphere }],
      // Distribution.
      ['pointsOnFaces',       { count: 32, seed: 11 },                                { geometry: sphere }],
      ['poissonDisk',         { minDistance: 0.18, maxSamples: 64, seed: 13 },        { geometry: box }],
      ['gridPoints',          { nx: 4, ny: 4, nz: 4 },                                { geometry: box }],
      // Sampling / filtering.
      ['sampleNearest',       { blend: 0.5 },                                         { A: box, B: sphereSmall }],
      ['greaterThan',         { attrName: 'foo', threshold: 0 },                      { geometry: box }],
      ['maskExtract',         { attrName: 'foo', threshold: 0 },                      { geometry: box }],
    ];
    const results = [];
    for (const [kind, params, inputs] of runs) {
      const r = window.__studioGeomTotalApply(kind, params, inputs);
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

  // ─── Spot-check: dodecahedron should have 12 pentagons → 36 tris → 108 verts.
  const dodecVerts = await win.evaluate(() => {
    const r = window.__studioGeomTotalApply('dodecahedron', { radius: 1 }, {});
    return r.ok ? r.vertices : -1;
  });
  expect(dodecVerts).toBe(108);

  // ─── Spot-check: tetrahedron should have 4 tris → 12 verts.
  const tetraVerts = await win.evaluate(() => {
    const r = window.__studioGeomTotalApply('tetrahedron', { radius: 1 }, {});
    return r.ok ? r.vertices : -1;
  });
  expect(tetraVerts).toBe(12);

  // ─── Spot-check: gridPoints (4×4×4) should have 64 points.
  const gridCount = await win.evaluate(() => {
    const r = window.__studioGeomTotalApply('gridPoints', { nx: 4, ny: 4, nz: 4 }, {});
    if (!r.ok) return -1;
    return (r.geometry.userData && r.geometry.userData.pointCount) || 0;
  });
  expect(gridCount).toBe(64);

  // ─── Spot-check: length attribute is actually written.
  const hasLengthAttr = await win.evaluate(async () => {
    const THREE = await import('three');
    const sphere = new THREE.SphereGeometry(0.5, 12, 8).toNonIndexed();
    const r = window.__studioGeomTotalApply('length', { attrName: 'len' }, { geometry: sphere });
    if (!r.ok) return false;
    const a = r.geometry.attributes.len;
    if (!a || a.itemSize !== 1 || a.count === 0) return false;
    // Every vert on a 0.5-radius sphere should have length ≈ 0.5.
    return Math.abs(a.getX(0) - 0.5) < 0.05;
  });
  expect(hasLengthAttr).toBe(true);

  // ─── Spot-check: maskExtract keeps fewer tris than input.
  const maskShrinks = await win.evaluate(async () => {
    const THREE = await import('three');
    const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const before = box.attributes.position.count;
    // Run greaterThan first to seed a 'mask' attribute, then extract.
    const gt = window.__studioGeomTotalApply('greaterThan',
      { attrName: 'noexist', threshold: 0, outAttr: 'mask' },
      { geometry: box });
    if (!gt.ok) return false;
    const mx = window.__studioGeomTotalApply('maskExtract',
      { attrName: 'mask', threshold: 0.5 },
      { geometry: gt.geometry });
    if (!mx.ok) return false;
    return mx.vertices > 0 && mx.vertices < before;
  });
  expect(maskShrinks).toBe(true);

  // ─── Build a geomtotal mesh INTO the scene so screenshots show real
  //     geometry. We wire: sphere → extrudeAlongNormal → recalculateNormals
  //     by chaining two geomtotal calls and inject the result as a
  //     fresh THREE.Mesh. ─────────────────────────────────────────────
  await win.evaluate(async () => {
    const THREE = await import('three');
    const base = new THREE.SphereGeometry(0.7, 32, 16).toNonIndexed();
    const step1 = window.__studioGeomTotalApply('extrudeAlongNormal',
      { distance: 0.12 },
      { geometry: base });
    if (!step1.ok) return;
    const step2 = window.__studioGeomTotalApply('faceWeightedNormal',
      {},
      { geometry: step1.geometry });
    if (!step2.ok) return;
    const geo = step2.geometry;
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ color: 0xb88be8, roughness: 0.4, metalness: 0.12 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'geomtotal-extruded';
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'geomtotal';
    if (window.__archdiscScene) window.__archdiscScene.add(mesh);
    if (window.__studioSelectMesh) try { window.__studioSelectMesh(mesh); } catch (_) {}
  });

  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-extruded-built.png') });

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
      '__studioGeomTotalApply',
      '__studioGeomTotalList',
      '__studioGeomTotal_tetrahedron',
      '__studioGeomTotal_helix',
      '__studioGeomTotal_poissonDisk',
      '__studioGeomTotal_maskExtract',
    ]));
  }

  // eslint-disable-next-line no-console
  console.log('  geomtotal: %d kinds OK, registeredVia=%s', list.count, list.registeredVia);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
