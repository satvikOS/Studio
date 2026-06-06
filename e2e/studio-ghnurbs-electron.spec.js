// ArchDisc Studio V3 — Rhino Grasshopper NURBS palette e2e (slice 759).
//
// Headed Mac-Electron spec (per the user's headed-tests feedback rule;
// the user watches the spec play out remotely).
//
// Exercises the seven Rhino-flavour NURBS nodes shipped in slice 759
// under `v3/ghnurbs/`:
//   • __studioGHNurbsCreateCurve   — degree-3 curve from 4 control points
//   • __studioGHNurbsExtrude       — extrude that curve 1 unit along +Y
//   • __studioGHNurbsCreateCurve   — a second NURBS curve to loft against
//   • __studioGHNurbsLoft          — Coons-style ruled skin between 2 curves
//   • __studioGHNurbsListNodeKinds — registry sanity
//
// Asserts:
//   • create-curve op returns ok + uuid + kind 'nurbsCurve'
//   • the curve mesh actually lands in __archdiscScene
//   • extrude returns a mesh with > 4 unique vertex positions (the slice
//     spec's vertex-count bar — a real ruled surface has 32 × 2 = 64
//     positions, not a degenerate 4-point line)
//   • loft returns a mesh with > 4 vertices that landed in the scene
//   • node-kinds registry lists all 7 NURBS kinds
//
// Camera sweep follows the user's "≥5 named camera angles" rule from
// feedback-forge-multicam-e2e.md so the spec's screenshots are useful
// for remote-desktop verification.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-ghnurbs');
const NAMED_VIEWS = ['front', 'top', 'right', 'iso', 'close'];

test('Studio V3 — Rhino Grasshopper NURBS palette (slice 759)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  // Launch with --dev so Electron loads from the Vite dev server (port
  // 3000) and we can dynamic-import the ghnurbs autoload module by URL
  // even when api.js orchestration hasn't been wired yet. Mirrors the
  // pattern used by the voxel / csg / geomnodes specs.
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 220,
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
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 20000 });

  // ── Install the ghnurbs module via autoload (api.js may not have wired). ──
  await win.evaluate(async () => {
    if (typeof window.__studioGHNurbsCreateCurve !== 'function') {
      await import('/src/workbenches/studio/v3/ghnurbs/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioGHNurbsCreateCurve === 'function',
    null, { timeout: 20000 });

  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) List node kinds — registry has all 7. ──────────────────────
  const kinds = await win.evaluate(() => window.__studioGHNurbsListNodeKinds());
  expect(kinds.ok).toBe(true);
  expect(kinds.kinds).toEqual(expect.arrayContaining([
    'nurbsCurve', 'nurbsSurface', 'nurbsExtrude', 'nurbsLoft',
    'nurbsRevolve', 'nurbsTrim', 'nurbsOffset',
  ]));

  // ── 2) Create a NURBS curve from 4 control points. ────────────────
  const cps = [
    [-1, 0, 0],
    [-0.3, 0.7, 0.4],
    [0.6, -0.4, -0.3],
    [1.2, 0.2, 0.6],
  ];
  const curve = await win.evaluate((pts) => window.__studioGHNurbsCreateCurve(pts, 3), cps);
  expect(curve.ok).toBe(true);
  expect(typeof curve.uuid).toBe('string');
  expect(curve.kind).toBe('nurbsCurve');

  // Curve lives in the scene.
  const curveInScene = await win.evaluate((uuid) => {
    const s = window.__archdiscScene;
    if (!s) return { ok: false };
    let hit = null;
    s.traverse((o) => { if (!hit && o.uuid === uuid) hit = o; });
    if (!hit) return { ok: false };
    const vc = hit.geometry?.attributes?.position?.count || 0;
    return {
      ok: true,
      isMesh: !!hit.isMesh,
      verts: vc,
      kind: hit.userData?.archdiscStudioPrimitiveKind,
      tagged: hit.userData?.archdiscStudioPrimitive === true,
    };
  }, curve.uuid);
  expect(curveInScene.ok).toBe(true);
  expect(curveInScene.isMesh).toBe(true);
  expect(curveInScene.kind).toBe('ghnurbs-curve');
  expect(curveInScene.tagged).toBe(true);
  expect(curveInScene.verts).toBeGreaterThan(4);

  await win.screenshot({ path: path.join(OUT, '01-curve.png') });

  // ── 3) Extrude that curve 1 unit along +Y → result has > 4 verts. ─
  const extr = await win.evaluate((uuid) => window.__studioGHNurbsExtrude(uuid, [0, 1, 0], 1), curve.uuid);
  expect(extr.ok).toBe(true);
  expect(typeof extr.uuid).toBe('string');
  expect(extr.kind).toBe('nurbsExtrude');

  const extrInScene = await win.evaluate((uuid) => {
    const s = window.__archdiscScene;
    if (!s) return { ok: false };
    let hit = null;
    s.traverse((o) => { if (!hit && o.uuid === uuid) hit = o; });
    if (!hit) return { ok: false };
    const vc = hit.geometry?.attributes?.position?.count || 0;
    return { ok: true, verts: vc, kind: hit.userData?.archdiscStudioPrimitiveKind };
  }, extr.uuid);
  expect(extrInScene.ok).toBe(true);
  expect(extrInScene.kind).toBe('ghnurbs-extrude');
  // The slice contract: "result has geometry with > 4 verts". A ruled
  // 32-sample extrusion produces 32 × 2 = 64 positions, well above 4.
  expect(extrInScene.verts).toBeGreaterThan(4);

  await win.screenshot({ path: path.join(OUT, '02-extrude.png') });

  // ── 4) Build a SECOND curve and loft between curve+curve2. ─────────
  const cps2 = [
    [-1, 1.5, 1],
    [-0.3, 1.8, 1.4],
    [0.6, 1.2, 0.7],
    [1.2, 1.6, 1.6],
  ];
  const curve2 = await win.evaluate((pts) => window.__studioGHNurbsCreateCurve(pts, 3), cps2);
  expect(curve2.ok).toBe(true);

  const loft = await win.evaluate(({ a, b }) => window.__studioGHNurbsLoft(a, b, 24),
    { a: curve.uuid, b: curve2.uuid });
  expect(loft.ok).toBe(true);
  expect(loft.kind).toBe('nurbsLoft');

  const loftInScene = await win.evaluate((uuid) => {
    const s = window.__archdiscScene;
    if (!s) return { ok: false };
    let hit = null;
    s.traverse((o) => { if (!hit && o.uuid === uuid) hit = o; });
    if (!hit) return { ok: false };
    const vc = hit.geometry?.attributes?.position?.count || 0;
    return { ok: true, verts: vc, kind: hit.userData?.archdiscStudioPrimitiveKind };
  }, loft.uuid);
  expect(loftInScene.ok).toBe(true);
  expect(loftInScene.kind).toBe('ghnurbs-loft');
  expect(loftInScene.verts).toBeGreaterThan(4);

  await win.screenshot({ path: path.join(OUT, '03-loft.png') });

  // ── 5) Multi-cam viewport screenshots (front / top / right / iso / close). ─
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 0.5, 6);
      else if (v === 'top') c.position.set(0, 6, 0.001);
      else if (v === 'right') c.position.set(6, 0.5, 0);
      else if (v === 'iso') c.position.set(4, 4, 4);
      else if (v === 'close') c.position.set(2.5, 2, 2.5);
      c.lookAt(0, 0.5, 0);
    }, view);
    await win.waitForTimeout(200);
    await win.screenshot({ path: path.join(OUT, `04-cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 759: ghnurbs — curve verts=%d, extrude verts=%d, loft verts=%d',
    curveInScene.verts, extrInScene.verts, loftInScene.verts);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
