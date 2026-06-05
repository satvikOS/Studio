import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-geomnodes');

test('Studio V3 — geometry nodes graph + build mesh (slice geomnodes-1)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  // Launch with --dev so Electron loads from the Vite dev server (port
  // 3000) and we can dynamic-import the geomnodes autoload module by URL
  // even when api.js orchestration hasn't been wired yet by the other
  // agent. Mirrors studio-v3-shader-electron.spec.js.
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

  // ─── Ensure the geomnodes module is installed. Either api.js has been
  // wired by the orchestrator (preferred) or we install it ourselves
  // via the autoload entry on the dev server. ────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioGeomNodeAdd !== 'function') {
      await import('/src/workbenches/studio/v3/geomnodes/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioGeomNodeAdd === 'function', null, { timeout: 15000 });

  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ─── The default-seeded graph should have 3 nodes. ────────────────
  const seeded = await win.evaluate(() => window.__studioGeomListNodes());
  expect(seeded.ok).toBe(true);
  expect(seeded.count).toBeGreaterThanOrEqual(3);

  // ─── Evaluate the seeded graph — should produce a sphere mesh. ────
  const ev0 = await win.evaluate(() => window.__studioGeomEvaluate());
  expect(ev0.ok).toBe(true);
  expect(ev0.vertices).toBeGreaterThan(0);
  expect(ev0.triangles).toBeGreaterThan(0);

  // ─── Build a real Mesh in the scene. ──────────────────────────────
  const built = await win.evaluate(() => window.__studioGeomBuildMesh());
  expect(built.ok).toBe(true);
  expect(typeof built.uuid).toBe('string');
  expect(built.vertices).toBeGreaterThan(0);

  // Confirm the mesh actually landed in the scene.
  const sceneHas = await win.evaluate((uuid) => {
    const s = window.__archdiscScene;
    if (!s) return false;
    let found = false;
    s.traverse((o) => { if (o.uuid === uuid) found = true; });
    return found;
  }, built.uuid);
  expect(sceneHas).toBe(true);

  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '01-seeded-built.png') });

  // ─── Wipe the graph and build a fresh torus → subdivide → array. ──
  await win.evaluate(() => {
    window.__studioGeomGraphDeserialize({ version: 1, nodes: [], wires: [] });
  });
  const empty = await win.evaluate(() => window.__studioGeomListNodes());
  expect(empty.count).toBe(0);

  const prim   = await win.evaluate(() => window.__studioGeomNodeAdd('primitive', { shape: 'torus', radius: 0.6, tubeRadius: 0.18, segments: 24 }));
  const subdiv = await win.evaluate(() => window.__studioGeomNodeAdd('subdivide', { iters: 1 }));
  const arr    = await win.evaluate(() => window.__studioGeomNodeAdd('array',     { count: 3, offsetXYZ: [1.6, 0, 0] }));
  const out    = await win.evaluate(() => window.__studioGeomNodeAdd('output',    {}));
  expect(prim.ok && subdiv.ok && arr.ok && out.ok).toBe(true);

  const c1 = await win.evaluate(({ a, b }) => window.__studioGeomNodeConnect(a, 'geometry', b, 'geometry'), { a: prim.uuid,   b: subdiv.uuid });
  const c2 = await win.evaluate(({ a, b }) => window.__studioGeomNodeConnect(a, 'geometry', b, 'geometry'), { a: subdiv.uuid, b: arr.uuid });
  const c3 = await win.evaluate(({ a, b }) => window.__studioGeomNodeConnect(a, 'geometry', b, 'geometry'), { a: arr.uuid,    b: out.uuid });
  expect(c1.ok && c2.ok && c3.ok).toBe(true);

  const ev1 = await win.evaluate(() => window.__studioGeomEvaluate());
  expect(ev1.ok).toBe(true);
  // 3 torus copies subdivided once = lots of triangles.
  expect(ev1.triangles).toBeGreaterThan(100);

  const built2 = await win.evaluate(() => window.__studioGeomBuildMesh());
  expect(built2.ok).toBe(true);

  // ─── Boolean op (difference) must produce non-trivial output. ────
  const bA = await win.evaluate(() => window.__studioGeomNodeAdd('primitive', { shape: 'box',    sizeX: 1, sizeY: 1, sizeZ: 1 }));
  const bB = await win.evaluate(() => window.__studioGeomNodeAdd('primitive', { shape: 'sphere', radius: 0.7, segments: 16 }));
  const bOp = await win.evaluate(() => window.__studioGeomNodeAdd('boolean', { op: 'difference' }));
  await win.evaluate(({ a, b }) => window.__studioGeomNodeConnect(a, 'geometry', b, 'A'), { a: bA.uuid, b: bOp.uuid });
  await win.evaluate(({ a, b }) => window.__studioGeomNodeConnect(a, 'geometry', b, 'B'), { a: bB.uuid, b: bOp.uuid });
  // Re-wire the existing output node to the boolean node.
  await win.evaluate(({ a, b }) => window.__studioGeomNodeConnect(a, 'geometry', b, 'geometry'), { a: bOp.uuid, b: out.uuid });
  const evBool = await win.evaluate(() => window.__studioGeomEvaluate());
  expect(evBool.ok).toBe(true);
  expect(evBool.triangles).toBeGreaterThan(0);

  // ─── Distribute on points — non-trivial output. ───────────────────
  const da = await win.evaluate(() => window.__studioGeomNodeAdd('primitive', { shape: 'sphere', radius: 0.08, segments: 8 }));
  const db = await win.evaluate(() => window.__studioGeomNodeAdd('primitive', { shape: 'box',    sizeX: 2, sizeY: 2, sizeZ: 2 }));
  const dist = await win.evaluate(() => window.__studioGeomNodeAdd('distribute', { density: 0.5, seed: 7 }));
  await win.evaluate(({ a, b }) => window.__studioGeomNodeConnect(a, 'geometry', b, 'A'), { a: da.uuid, b: dist.uuid });
  await win.evaluate(({ a, b }) => window.__studioGeomNodeConnect(a, 'geometry', b, 'B'), { a: db.uuid, b: dist.uuid });
  await win.evaluate(({ a, b }) => window.__studioGeomNodeConnect(a, 'geometry', b, 'geometry'), { a: dist.uuid, b: out.uuid });
  const evDist = await win.evaluate(() => window.__studioGeomEvaluate());
  expect(evDist.ok).toBe(true);
  expect(evDist.vertices).toBeGreaterThan(0);

  // ─── Curve node alone. ────────────────────────────────────────────
  const curve = await win.evaluate(() => window.__studioGeomNodeAdd('curve', {
    points: [[-1, 0, 0], [-0.3, 0.7, 0.4], [0.6, -0.4, -0.3], [1.2, 0.2, 0.6]],
    tubeRadius: 0.1, tubularSegments: 32, radialSegments: 6, closed: false,
  }));
  await win.evaluate(({ a, b }) => window.__studioGeomNodeConnect(a, 'geometry', b, 'geometry'), { a: curve.uuid, b: out.uuid });
  const evCurve = await win.evaluate(() => window.__studioGeomEvaluate());
  expect(evCurve.ok).toBe(true);
  expect(evCurve.triangles).toBeGreaterThan(10);

  // ─── Serialize → clear → deserialize round-trips. ─────────────────
  const ser = await win.evaluate(() => window.__studioGeomGraphSerialize());
  expect(ser.ok).toBe(true);
  expect(Array.isArray(ser.json.nodes)).toBe(true);
  const nodeCountBefore = ser.json.nodes.length;

  await win.evaluate(() => {
    window.__studioGeomGraphDeserialize({ version: 1, nodes: [], wires: [] });
  });
  const empty2 = await win.evaluate(() => window.__studioGeomListNodes());
  expect(empty2.count).toBe(0);

  const restored = await win.evaluate((j) => window.__studioGeomGraphDeserialize(j), ser.json);
  expect(restored.ok).toBe(true);
  expect(restored.count).toBe(nodeCountBefore);

  // ─── Editor open → DOM mounted → close. ───────────────────────────
  await win.evaluate(() => window.__studioGeomEditorOpen());
  await expect(win.locator('[data-studio-v3-geomnodes-editor]')).toBeVisible({ timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '02-editor-open.png') });

  await win.locator('[data-studio-v3-geomnodes-add="primitive"]').first().click();
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '03-editor-add.png') });

  await win.locator('[data-studio-v3-geomnodes-apply]').click();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '04-editor-build.png') });

  await win.locator('[data-studio-v3-geomnodes-close]').click();
  await expect(win.locator('[data-studio-v3-geomnodes-editor]')).toBeHidden();

  // ─── Command palette registration. ────────────────────────────────
  const palette = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { ok: false };
    return window.__studioCommandList('geomnodes');
  });
  if (palette.ok) {
    expect(palette.count).toBeGreaterThanOrEqual(10);
    const names = palette.commands.map((c) => c.name);
    expect(names).toContain('__studioGeomBuildMesh');
  }

  // ─── Multi-cam viewport screenshots (front / top / right / iso / close). ─
  for (const view of ['front', 'top', 'right', 'iso', 'close']) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 0, 6);
      else if (v === 'top') c.position.set(0, 6, 0.001);
      else if (v === 'right') c.position.set(6, 0, 0);
      else if (v === 'iso') c.position.set(4, 4, 4);
      else if (v === 'close') c.position.set(2, 2, 2);
      c.lookAt(0, 0, 0);
    }, view);
    await win.waitForTimeout(200);
    await win.screenshot({ path: path.join(OUT, `05-cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  geomnodes: seeded=%d, built ok=%s, restored=%d', seeded.count, built.ok, restored.count);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
