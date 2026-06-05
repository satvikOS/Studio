// ArchDisc Studio V3 — vector / SVG 3D e2e (headed Mac-Electron).
//
// Launches Electron in --dev mode (Vite at localhost:3000) so we can
// dynamic-import vector/autoload.js by URL even when api.js
// orchestration hasn't been wired by the slice-merge orchestrator
// yet — same trick the shader / sim specs use.
//
// Exercises the full op surface per slice spec:
//
//   1. pathOps: __studioVectorClosePath / OffsetPath / ChamferPath
//      on synthetic 2D point arrays — pure functional, no scene.
//   2. SVG import: __studioVectorImportSvg parses an inline
//      <path d="M..."> rect outline, returns a uuid + path count,
//      and the mesh is centred on origin.
//   3. Logo from JSON: __studioVectorLogoFromPaths builds an extruded
//      diamond + a square-with-hole into one group.
//   4. Text mesh: __studioVectorCreateText with the default Helvetiker
//      font. If the network fetch fails (offline CI), we accept the
//      clean error result instead of failing the test — same fault
//      tolerance the Studio chrome uses for the bundled font load.
//   5. Font registry: __studioVectorListFonts shows the default URL;
//      __studioVectorSetActiveFont swaps it; the list reflects.
//   6. Command palette: every __studioVector* op is registered under
//      category 'vector'.
//   7. Multi-cam screenshots (front/iso/right/top/close) per the
//      Forge multi-cam memory.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-vector');

// Tiny inline SVG: a 100×60 rect with rounded corners + a triangle.
// SVGLoader handles `path d=...` and `rect` natively.
const TEST_SVG = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <rect x="10" y="10" width="100" height="60" rx="8" ry="8" fill="#3366cc"/>
  <path d="M 130 10 L 190 10 L 160 70 Z" fill="#cc6633"/>
</svg>`;

test('Studio V3 — vector / SVG 3D + text mesh + path ops', async () => {
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

  // Ensure the vector autoload has run; install via dev URL otherwise.
  await win.evaluate(async () => {
    if (typeof window.__studioVectorImportSvg !== 'function') {
      await import('/src/workbenches/studio/v3/vector/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioVectorImportSvg === 'function'
       && typeof window.__studioVectorCreateText === 'function'
       && typeof window.__studioVectorLogoFromPaths === 'function'
       && typeof window.__studioVectorOffsetPath === 'function'
       && typeof window.__studioVectorChamferPath === 'function'
       && typeof window.__studioVectorClosePath === 'function'
       && typeof window.__studioVectorListFonts === 'function'
       && typeof window.__studioVectorSetActiveFont === 'function',
    null, { timeout: 15000 },
  );

  // ─── 1. pathOps ─────────────────────────────────────────────────────
  const square = [[0, 0], [1, 0], [1, 1], [0, 1]];

  // closePath should append the first vertex to make a 5-point ring.
  const closed = await win.evaluate((pts) => window.__studioVectorClosePath(pts), square);
  expect(closed.ok).toBe(true);
  expect(closed.points.length).toBe(5);
  expect(closed.points[4]).toEqual([0, 0]);
  expect(closed.closed).toBe(true);

  // closePath idempotency — calling on an already-closed loop is a
  // no-op (length unchanged).
  const closedTwice = await win.evaluate((pts) => window.__studioVectorClosePath(pts), closed.points);
  expect(closedTwice.points.length).toBe(5);

  // offsetPath: expand the unit square outward by 0.1. Corner verts
  // sit on the average of two adjacent edge normals at a 45° angle,
  // so the displacement magnitude per corner is 0.1 * sqrt(2) ≈ 0.1414
  // (mitre compensation). We assert the corners moved roughly that far.
  const expanded = await win.evaluate(
    (pts) => window.__studioVectorOffsetPath(pts, 0.1),
    square,
  );
  expect(expanded.ok).toBe(true);
  expect(expanded.points.length).toBe(4);
  // The original [1,1] corner should be displaced into the +X+Y
  // quadrant relative to the square's centre [0.5, 0.5]. We just
  // assert it moved outward.
  const movedRight = expanded.points[2];
  expect(movedRight[0]).toBeGreaterThan(1);
  expect(movedRight[1]).toBeGreaterThan(1);

  // chamferPath: clip each corner of an open triangle by 0.2. Interior
  // corners (1) double; endpoints (2) stay. Input 4 pts → output 5 pts.
  const tri = [[0, 0], [1, 0], [1, 1], [0, 0.001]];
  const chamfered = await win.evaluate(
    (pts) => window.__studioVectorChamferPath(pts, 0.2),
    tri,
  );
  expect(chamfered.ok).toBe(true);
  // First + last preserved; two interior vertices each become two.
  expect(chamfered.points.length).toBe(6);
  expect(chamfered.points[0]).toEqual([0, 0]);

  // ─── 2. SVG import ──────────────────────────────────────────────────
  const svgRes = await win.evaluate(
    (svg) => window.__studioVectorImportSvg(svg, 0.1, 0.01),
    TEST_SVG,
  );
  expect(svgRes.ok).toBe(true);
  expect(typeof svgRes.uuid).toBe('string');
  expect(svgRes.paths).toBeGreaterThan(0);
  expect(svgRes.shapes).toBeGreaterThan(0);
  expect(svgRes.depth).toBe(0.1);

  // Verify the group exists and contains sub-meshes.
  const svgInfo = await win.evaluate((u) => {
    const g = window.__archdiscScene.getObjectByProperty('uuid', u);
    if (!g) return { found: false };
    let meshes = 0;
    let totalVerts = 0;
    g.traverse((o) => {
      if (o.isMesh && o.geometry && o.geometry.attributes.position) {
        meshes++;
        totalVerts += o.geometry.attributes.position.count;
      }
    });
    return {
      found: true,
      kind: g.userData.archdiscStudioPrimitiveKind,
      meshes,
      totalVerts,
    };
  }, svgRes.uuid);
  expect(svgInfo.found).toBe(true);
  expect(svgInfo.kind).toBe('svg');
  expect(svgInfo.meshes).toBeGreaterThan(0);
  expect(svgInfo.totalVerts).toBeGreaterThan(0);

  // Push the SVG mesh to the side so the next primitives don't overlap.
  await win.evaluate((u) => {
    const g = window.__archdiscScene.getObjectByProperty('uuid', u);
    if (g) { g.position.set(-2, 0, 0); g.updateMatrixWorld(true); }
  }, svgRes.uuid);

  await win.screenshot({ path: path.join(OUT, '01-svg.png') });

  // ─── 3. Logo from JSON paths ────────────────────────────────────────
  const logoJson = [
    {
      // A diamond.
      points: [[0, 0.5], [0.5, 0], [0, -0.5], [-0.5, 0]],
      color: 0xff9933,
    },
    {
      // A unit square offset to the right, with a smaller square hole.
      points: [[1, -0.5], [2, -0.5], [2, 0.5], [1, 0.5]],
      holes: [[[1.25, -0.25], [1.75, -0.25], [1.75, 0.25], [1.25, 0.25]]],
      color: 0x33cccc,
    },
  ];
  const logoRes = await win.evaluate(
    (json) => window.__studioVectorLogoFromPaths(json, 0.15, 0.01),
    logoJson,
  );
  expect(logoRes.ok).toBe(true);
  expect(logoRes.paths).toBe(2);
  expect(logoRes.depth).toBeCloseTo(0.15, 5);

  await win.evaluate((u) => {
    const g = window.__archdiscScene.getObjectByProperty('uuid', u);
    if (g) { g.position.set(2, 0, 0); g.updateMatrixWorld(true); }
  }, logoRes.uuid);

  await win.screenshot({ path: path.join(OUT, '02-logo.png') });

  // ─── 4. Text mesh ───────────────────────────────────────────────────
  // Network fetch may fail offline; we tolerate either outcome but
  // assert the API contract.
  const text = await win.evaluate(
    () => window.__studioVectorCreateText('STUDIO', {
      size: 0.6, depth: 0.18, color: 0xffdd66, position: [0, 0.5, 0],
    }),
  );
  expect(text).toBeDefined();
  if (text.ok) {
    expect(typeof text.uuid).toBe('string');
    expect(text.text).toBe('STUDIO');
    expect(text.verts).toBeGreaterThan(0);
    const textInfo = await win.evaluate((u) => {
      const m = window.__archdiscScene.getObjectByProperty('uuid', u);
      return m && m.isMesh ? { has: true, kind: m.userData.archdiscStudioPrimitiveKind } : { has: false };
    }, text.uuid);
    expect(textInfo.has).toBe(true);
    expect(textInfo.kind).toBe('vector-text');
  } else {
    // Offline-CI graceful failure path. Must surface a string error.
    expect(typeof text.error).toBe('string');
    expect(text.error.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log('  vector text fetch declined (likely offline): ' + text.error);
  }

  await win.screenshot({ path: path.join(OUT, '03-text.png') });

  // ─── 5. Font registry ───────────────────────────────────────────────
  const fontsBefore = await win.evaluate(() => window.__studioVectorListFonts());
  expect(fontsBefore.ok).toBe(true);
  expect(typeof fontsBefore.active).toBe('string');
  expect(fontsBefore.active).toContain('helvetiker');
  expect(Array.isArray(fontsBefore.fonts)).toBe(true);

  const fakeUrl = 'https://example.invalid/font.json';
  const setRes = await win.evaluate((u) => window.__studioVectorSetActiveFont(u), fakeUrl);
  expect(setRes.ok).toBe(true);
  expect(setRes.active).toBe(fakeUrl);

  const fontsAfter = await win.evaluate(() => window.__studioVectorListFonts());
  expect(fontsAfter.active).toBe(fakeUrl);
  // Restore default for tidy state.
  await win.evaluate(
    (def) => window.__studioVectorSetActiveFont(def),
    'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_regular.typeface.json',
  );

  // ─── 6. Command palette registration ────────────────────────────────
  const vectorCmds = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { ok: false };
    return window.__studioCommandList('vector');
  });
  expect(vectorCmds.ok).toBe(true);
  const names = vectorCmds.commands.map((c) => c.name);
  for (const expected of [
    '__studioVectorImportSvg', '__studioVectorCreateText',
    '__studioVectorLogoFromPaths', '__studioVectorOffsetPath',
    '__studioVectorChamferPath', '__studioVectorClosePath',
    '__studioVectorListFonts', '__studioVectorSetActiveFont',
  ]) {
    expect(names).toContain(expected);
  }
  expect(vectorCmds.commands.length).toBeGreaterThanOrEqual(8);

  // ─── 7. Multi-cam screenshots ───────────────────────────────────────
  const cams = [
    { name: 'front', pos: [0, 1, 5],    target: [0, 0, 0] },
    { name: 'iso',   pos: [4, 4, 4],    target: [0, 0, 0] },
    { name: 'right', pos: [6, 0.5, 0],  target: [0, 0, 0] },
    { name: 'top',   pos: [0, 6, 0.01], target: [0, 0, 0] },
    { name: 'close', pos: [1.5, 1, 2.5], target: [0, 0, 0] },
  ];
  for (const c of cams) {
    await win.evaluate(({ pos, target }) => {
      const v = window.__archdiscViewport;
      if (!v) return;
      v.camera.position.set(pos[0], pos[1], pos[2]);
      v.camera.lookAt(target[0], target[1], target[2]);
      if (v.orbitControls) {
        v.orbitControls.target.set(target[0], target[1], target[2]);
        v.orbitControls.update();
      }
      v.camera.updateMatrixWorld(true);
      v.renderer.render(v.scene, v.camera);
    }, c);
    await win.waitForTimeout(200);
    await win.screenshot({ path: path.join(OUT, `04-${c.name}.png`) });
  }

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log(`  vector: svg ${svgInfo.meshes} sub-meshes / ${svgInfo.totalVerts} verts, ` +
              `logo ${logoRes.paths} paths, ` +
              `text ${text.ok ? text.verts + ' verts' : 'offline'}, ` +
              `${vectorCmds.commands.length} commands`);

  await app.close();
});
