import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-hda');

// Mac-Electron headed spec for HDA bundles + 15 more geometry nodes.
// The spec:
//   1. dynamic-imports geomnodes/, geomdeep/, geomtotal/, hda/ autoloads
//      on the Vite dev server (so the orchestrator wiring is optional)
//   2. confirms __studioHDA* surface + 15 per-kind __studioHDA_<kind> ops
//   3. exercises every kind end-to-end with real BufferGeometry inputs
//   4. packs a sub-graph as an HDA, unpacks + instantiates it with param
//      overrides, asserts the result mesh lives in the scene
//   5. exercises Export + Import roundtrip
//   6. opens the React HDA panel and verifies it lists the packed asset
//   7. captures 5 named camera angles after building a representative
//      HDA mesh (per the headed-tests + multi-cam directives)

test('Studio V3 — HDA bundles + 15 more SOPs (Houdini parity depth)', async () => {
  test.setTimeout(240000);
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
    // Wipe any previously-stored HDAs so listHDAs counts are clean.
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('studio.v3.hda.')) window.localStorage.removeItem(k);
    }
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function', null, { timeout: 20000 });

  // ─── Ensure every autoload entry has run. ──────────────────────────
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
    if (typeof window.__studioHDAPack !== 'function') {
      await import('/src/workbenches/studio/v3/hda/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioHDAPack === 'function', null, { timeout: 20000 });
  await win.waitForFunction(() => typeof window.__studioHDAListKinds === 'function', null, { timeout: 20000 });

  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ─── Discovery: all 15 kinds present + per-kind convenience ops. ──
  const list = await win.evaluate(() => window.__studioHDAListKinds());
  expect(list.ok).toBe(true);
  expect(list.count).toBe(15);
  const expectedKinds = [
    'bridge', 'skin', 'sweep2', 'realBoolean', 'loft',
    'attributeTransfer', 'promote', 'cast', 'random',
    'knife', 'mirror', 'smooth',
    'resample', 'arc', 'bezier',
  ];
  const seenKinds = list.kinds.map((k) => k.kind).sort();
  expect(seenKinds).toEqual(expectedKinds.slice().sort());

  // Every convenience op must be a function.
  const opsPresent = await win.evaluate((names) => {
    return names.every((n) => typeof window['__studioHDA_' + n] === 'function');
  }, expectedKinds);
  expect(opsPresent).toBe(true);

  // Fallback map populated.
  const mapHas = await win.evaluate((names) => {
    const m = window.__studioHDANodes || {};
    return names.every((n) => !!m[n]);
  }, expectedKinds);
  expect(mapHas).toBe(true);

  // ─── Per-kind smoke evaluation. ───────────────────────────────────
  const allOk = await win.evaluate(async () => {
    const THREE = await import('three');
    const ringA = new THREE.RingGeometry(0.4, 0.5, 16).toNonIndexed();
    // Shift ringB up the Y axis so Bridge / Loft can stitch the two
    // into a tube.
    const ringB = new THREE.RingGeometry(0.4, 0.5, 16).toNonIndexed();
    ringB.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 1, 0));
    const profSquare = (() => {
      // 4-point square profile (in XY) as a BufferGeometry.
      const verts = new Float32Array([
        -0.1, -0.1, 0,
         0.1, -0.1, 0,
         0.1,  0.1, 0,
        -0.1,  0.1, 0,
      ]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      return g;
    })();
    const profCircle = (() => {
      const N = 12;
      const verts = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        verts[i * 3]     = Math.cos(a) * 0.08;
        verts[i * 3 + 1] = Math.sin(a) * 0.08;
        verts[i * 3 + 2] = 0;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      return g;
    })();
    const pathLine = (() => {
      const verts = new Float32Array([
        -0.8, 0, 0,
        -0.3, 0.4, 0.2,
         0.3, 0.4, -0.2,
         0.8, 0, 0,
      ]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      return g;
    })();
    const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const sphere = new THREE.SphereGeometry(0.6, 24, 12).toNonIndexed();
    const sphereOffset = new THREE.SphereGeometry(0.4, 16, 10).toNonIndexed();
    sphereOffset.applyMatrix4(new THREE.Matrix4().makeTranslation(0.4, 0, 0));

    const runs = [
      // Topology (5)
      ['bridge',            { closed: true },                                                     { A: ringA, B: ringB }],
      ['skin',              { radius: 0.05, radialSegments: 8 },                                  { curve: pathLine }],
      ['sweep2',            { stations: 12, closeProfile: true },                                 { profileA: profSquare, profileB: profCircle, path: pathLine }],
      ['realBoolean',       { op: 'union' },                                                      { A: sphere, B: sphereOffset }],
      ['loft',              { steps: 12, closed: true },                                          { A: ringA, B: ringB }],
      // Attribute (4)
      ['attributeTransfer', { srcAttr: 'noattr', outAttr: 'transferred' },                        { A: sphere, B: box }],
      ['promote',           { srcAttr: 'noattr', outAttr: 'face_mask' },                          { geometry: box }],
      ['cast',              { srcAttr: 'noattr', outAttr: 'mask_int' },                           { geometry: box }],
      ['random',            { outAttr: 'r', min: 0, max: 1, seed: 7 },                            { geometry: box }],
      // Modeling (3)
      ['knife',             { point: [0, 0, 0], normal: [0, 1, 0], keep: 'above' },               { geometry: sphere }],
      ['mirror',            { axis: 'x', merge: true },                                           { geometry: sphere }],
      ['smooth',            { iters: 2, factor: 0.5, presubdivide: 0 },                           { geometry: sphere }],
      // Curves (3)
      ['resample',          { count: 24 },                                                        { curve: pathLine }],
      ['arc',               { radius: 0.5, startAngle: 0, endAngle: Math.PI * 1.5, count: 24 },   {}],
      ['bezier',            { count: 24 },                                                        {}],
    ];
    const results = [];
    for (const [kind, params, inputs] of runs) {
      const r = window.__studioHDAApply(kind, params, inputs);
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

  // ─── Spot-checks. ─────────────────────────────────────────────────
  // Random attribute: every vertex has a deterministic float in [0..1].
  const randStable = await win.evaluate(async () => {
    const THREE = await import('three');
    const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const r1 = window.__studioHDAApply('random', { outAttr: 'r', seed: 7 }, { geometry: box });
    const r2 = window.__studioHDAApply('random', { outAttr: 'r', seed: 7 }, { geometry: box });
    if (!r1.ok || !r2.ok) return false;
    const a = r1.geometry.attributes.r;
    const b = r2.geometry.attributes.r;
    if (!a || !b || a.count !== b.count) return false;
    for (let i = 0; i < a.count; i++) {
      if (Math.abs(a.getX(i) - b.getX(i)) > 1e-9) return false;
      if (a.getX(i) < 0 || a.getX(i) > 1) return false;
    }
    return true;
  });
  expect(randStable).toBe(true);

  // Mirror should at least double the vertex count.
  const mirrorDoubles = await win.evaluate(async () => {
    const THREE = await import('three');
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, 0, 0,  1, 0, 0,  0.5, 1, 0,
    ]), 3));
    const before = tri.attributes.position.count;
    const r = window.__studioHDAApply('mirror', { axis: 'x', merge: true }, { geometry: tri });
    if (!r.ok) return false;
    return r.vertices === before * 2;
  });
  expect(mirrorDoubles).toBe(true);

  // Knife should drop ~half the verts of a sphere cut at the equator.
  const knifeShrinks = await win.evaluate(async () => {
    const THREE = await import('three');
    const sphere = new THREE.SphereGeometry(0.5, 24, 12).toNonIndexed();
    const before = sphere.attributes.position.count;
    const r = window.__studioHDAApply('knife',
      { point: [0, 0, 0], normal: [0, 1, 0], keep: 'above' },
      { geometry: sphere });
    if (!r.ok) return -1;
    return r.vertices < before && r.vertices > 0;
  });
  expect(knifeShrinks).toBe(true);

  // Resample should produce exactly `count` points.
  const resampleCount = await win.evaluate(async () => {
    const THREE = await import('three');
    const line = new THREE.BufferGeometry();
    line.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, 0, 0,   -0.3, 0.3, 0,   0.3, -0.3, 0,   1, 0, 0,
    ]), 3));
    const r = window.__studioHDAApply('resample', { count: 50 }, { curve: line });
    return r.ok ? r.vertices : -1;
  });
  expect(resampleCount).toBe(50);

  // Arc should produce exactly `count` points and userData.curve = true.
  const arcCurve = await win.evaluate(() => {
    const r = window.__studioHDAApply('arc',
      { radius: 0.5, startAngle: 0, endAngle: Math.PI, count: 20 }, {});
    if (!r.ok) return false;
    return r.vertices === 20 && r.geometry.userData && r.geometry.userData.curve === true;
  });
  expect(arcCurve).toBe(true);

  // Bezier endpoints match.
  const bezierEnds = await win.evaluate(() => {
    const r = window.__studioHDAApply('bezier', {
      p0: [-1, 0, 0], c1: [-0.5, 1, 0], c2: [0.5, 1, 0], p1: [1, 0, 0], count: 30,
    }, {});
    if (!r.ok) return false;
    const a = r.geometry.attributes.position;
    const last = a.count - 1;
    return Math.abs(a.getX(0) - (-1)) < 1e-6 && Math.abs(a.getX(last) - 1) < 1e-6;
  });
  expect(bezierEnds).toBe(true);

  // ─── Pack / Unpack / Instantiate round-trip with overrides. ───────
  // Build a small sub-graph: primitive(sphere) → transform → output.
  const packed = await win.evaluate(() => {
    const sub = {
      nodes: [
        { id: 'n1', kind: 'primitive', params: { shape: 'sphere', radius: 0.6, segments: 24 }, x: 60, y: 120 },
        { id: 'n2', kind: 'transform', params: { position: [0, 0, 0], scale: [1, 1, 1] },     x: 300, y: 120 },
        { id: 'n3', kind: 'output',    params: {},                                              x: 540, y: 120 },
      ],
      wires: [
        { srcId: 'n1', srcOut: 'geometry', dstId: 'n2', dstIn: 'geometry' },
        { srcId: 'n2', srcOut: 'geometry', dstId: 'n3', dstIn: 'geometry' },
      ],
    };
    const exposed = [
      { key: 'radius', nodeId: 'n1', param: 'radius' },
      { key: 'lift',   nodeId: 'n2', param: 'position' },
    ];
    return window.__studioHDAPack('TestBall', sub, exposed);
  });
  expect(packed.ok).toBe(true);
  expect(packed.name).toBe('TestBall');

  // List should see it.
  const listed = await win.evaluate(() => window.__studioHDAList());
  expect(listed.ok).toBe(true);
  expect(listed.count).toBeGreaterThanOrEqual(1);
  expect(listed.hdas.find((h) => h.name === 'TestBall')).toBeTruthy();

  // Unpack returns the subgraph + exposed.
  const unpacked = await win.evaluate(() => window.__studioHDAUnpack('TestBall'));
  expect(unpacked.ok).toBe(true);
  expect(unpacked.subgraph.nodes.length).toBe(3);
  expect(unpacked.exposedParams.length).toBe(2);

  // Instantiate with no overrides — should land a mesh in the scene.
  const inst1 = await win.evaluate(() => window.__studioHDAInstantiate('TestBall'));
  expect(inst1.ok).toBe(true);
  expect(inst1.uuid).toBeTruthy();
  expect(inst1.verts).toBeGreaterThan(0);

  // Instantiate with param overrides — radius bumped to 1.0, position
  // shifted. Verts should differ from the no-override pass (larger
  // sphere → same vert count but different positions; we just assert
  // it's still > 0 and produced a different uuid).
  const inst2 = await win.evaluate(() => window.__studioHDAInstantiate('TestBall', {
    radius: 1.0,
    lift: [1.5, 0, 0],
  }));
  expect(inst2.ok).toBe(true);
  expect(inst2.uuid).toBeTruthy();
  expect(inst2.uuid).not.toBe(inst1.uuid);

  // Confirm both meshes live in the scene as hda-instance primitives.
  const sceneHDA = await win.evaluate(() => {
    if (!window.__archdiscScene) return [];
    const out = [];
    window.__archdiscScene.traverse((o) => {
      if (o.isMesh && o.userData &&
          o.userData.archdiscStudioPrimitiveKind === 'hda-instance') {
        out.push({ uuid: o.uuid, name: o.userData.archdiscStudioHDAName, verts: o.geometry.attributes.position.count });
      }
    });
    return out;
  });
  expect(sceneHDA.length).toBeGreaterThanOrEqual(2);

  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '01-instantiated.png') });

  // ─── Export / Import round-trip. ─────────────────────────────────
  const exp = await win.evaluate(() => window.__studioHDAExport('TestBall'));
  expect(exp.ok).toBe(true);
  expect(exp.json.length).toBeGreaterThan(20);
  // Mutate the name in the exported JSON and re-import.
  const imp = await win.evaluate((json) => {
    const obj = JSON.parse(json);
    obj.name = 'TestBallImported';
    return window.__studioHDAImport(obj);
  }, exp.json);
  expect(imp.ok).toBe(true);
  expect(imp.name).toBe('TestBallImported');
  const listed2 = await win.evaluate(() => window.__studioHDAList());
  expect(listed2.hdas.find((h) => h.name === 'TestBallImported')).toBeTruthy();

  // Delete the original.
  const del = await win.evaluate(() => window.__studioHDADelete('TestBall'));
  expect(del.ok).toBe(true);
  const listed3 = await win.evaluate(() => window.__studioHDAList());
  expect(listed3.hdas.find((h) => h.name === 'TestBall')).toBeFalsy();

  // ─── Open the panel and verify it lists the remaining HDA. ───────
  await win.evaluate(() => window.__studioHDAPanelOpen());
  await expect(win.locator('[data-studio-v3-hda-panel]')).toBeVisible({ timeout: 5000 });
  await expect(win.locator('[data-studio-v3-hda-row][data-name="TestBallImported"]')).toBeVisible({ timeout: 5000 });
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '02-panel.png') });

  // Toggle closes the panel.
  await win.evaluate(() => window.__studioHDAPanelToggle());
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '03-panel-closed.png') });

  // ─── Build a representative HDA chain INTO the scene so screenshots
  //     show something pretty: bridge two rings into a tube. ─────────
  await win.evaluate(async () => {
    const THREE = await import('three');
    // Two rings 1 unit apart on the Y axis.
    const ringA = new THREE.RingGeometry(0.6, 0.65, 24).toNonIndexed();
    const ringB = new THREE.RingGeometry(0.4, 0.45, 24).toNonIndexed();
    ringB.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 1.2, 0));
    const step = window.__studioHDAApply('loft', { steps: 16, closed: true }, { A: ringA, B: ringB });
    if (!step.ok) return;
    const geo = step.geometry;
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ color: 0x6ed7c6, roughness: 0.4, metalness: 0.12 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'hda-loft-demo';
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'hda';
    if (window.__archdiscScene) window.__archdiscScene.add(mesh);
    if (window.__studioSelectMesh) try { window.__studioSelectMesh(mesh); } catch (_) {}
  });

  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '04-loft-demo.png') });

  // ─── Multi-cam viewport screenshots. ──────────────────────────────
  for (const view of ['front', 'top', 'right', 'iso', 'close']) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 0.6, 4);
      else if (v === 'top') c.position.set(0, 4, 0.001);
      else if (v === 'right') c.position.set(4, 0.6, 0);
      else if (v === 'iso') c.position.set(3, 3, 3);
      else if (v === 'close') c.position.set(1.5, 1.5, 1.5);
      c.lookAt(0, 0.5, 0);
    }, view);
    await win.waitForTimeout(200);
    await win.screenshot({ path: path.join(OUT, `05-cam-${view}.png`) });
  }

  // ─── Command palette should see at least the new ops. ────────────
  const palette = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { ok: false };
    return window.__studioCommandList('geomnodes');
  });
  if (palette.ok) {
    const names = palette.commands.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining([
      '__studioHDAPack',
      '__studioHDAUnpack',
      '__studioHDAInstantiate',
      '__studioHDAList',
      '__studioHDA_bridge',
      '__studioHDA_loft',
      '__studioHDA_realBoolean',
      '__studioHDA_bezier',
      '__studioHDAPanelToggle',
    ]));
  }

  // eslint-disable-next-line no-console
  console.log('  hda: %d kinds OK, registeredVia=%s', list.count, list.registeredVia);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
