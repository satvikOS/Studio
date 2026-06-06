// ArchDisc Studio V3 — Multi-resolution sculpting levels e2e (slice 733).
//
// Headed Mac-Electron spec. Multires lets an artist sculpt broad form at
// a LOW subdivision level and fine detail at a HIGH level, then step DOWN
// to adjust the low-frequency shape without destroying the high-frequency
// detail (ZBrush SubDiv levels, Mudbox subdivision levels, Blender
// Multires modifier).
//
// Exercises __studioMultires* (subdiv/multires.js):
//   • spawn a mesh + init the multires stack (level 0 = base)
//   • subdivide twice → level vertex counts climb
//   • sculpt a bump at the top level, bake it → detail magnitude > 0
//   • step DOWN to level 0 (vert count drops to base), step back UP →
//     the high-frequency bump is PRESERVED (the whole point of multires)
//   • global search surfaces the ops
//   • camera sweep for remote verification

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-multires');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — multi-resolution sculpting levels (ZBrush SubDiv)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
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
  // Resilient boot (retry reload on cold-start race).
  let shellUp = false;
  for (let attempt = 0; attempt < 3 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    try {
      await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 25000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 30000 });

  await win.evaluate(async () => {
    if (typeof window.__studioMultiresInit !== 'function') {
      await import('/src/workbenches/studio/v3/subdiv/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioMultiresInit === 'function',
    null, { timeout: 20000 });

  // Clean scene + spawn a single primitive to sculpt.
  await win.evaluate(() => { if (window.__studioClearScene) window.__studioClearScene(); });
  const spawned = await win.evaluate(() => {
    const scene = window.__archdiscScene;
    // Prefer the platform spawn op if present.
    if (typeof window.__studioSpawnPrimitive === 'function') return window.__studioSpawnPrimitive('icosahedron');
    return { ok: false };
  });
  // Fall back: import spawn helper directly if no op.
  await win.evaluate(async () => {
    const scene = window.__archdiscScene;
    const has = [];
    scene.traverse((o) => { if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) has.push(o); });
    if (has.length === 0) {
      const m = await import('/src/workbenches/studio/v3/spawn.js');
      m.spawnPrimitive('icosahedron', scene);
    }
  });
  // Select the spawned mesh (pass the mesh OBJECT — __studioSelectMesh
  // attaches transform controls to it) and capture its uuid.
  const sel = await win.evaluate(() => {
    const scene = window.__archdiscScene;
    let mesh = null;
    scene.traverse((o) => { if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) mesh = o; });
    if (mesh && window.__studioSelectMesh) window.__studioSelectMesh(mesh);
    return mesh ? { uuid: mesh.uuid } : null;
  });
  expect(sel).not.toBeNull();
  const UUID = sel.uuid;
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '00-base.png') });

  // ── 1) Init the multires stack (target the mesh by uuid). ──────────
  const init = await win.evaluate((u) => window.__studioMultiresInit(u), UUID);
  expect(init.ok).toBe(true);
  expect(init.levels).toBe(1);
  expect(init.current).toBe(0);
  const baseVerts = init.baseVerts;
  expect(baseVerts).toBeGreaterThan(0);

  // ── 2) Subdivide twice → finer levels. ─────────────────────────────
  const s1 = await win.evaluate((u) => window.__studioMultiresSubdivide(u), UUID);
  expect(s1.ok).toBe(true);
  expect(s1.level).toBe(1);
  const s2 = await win.evaluate((u) => window.__studioMultiresSubdivide(u), UUID);
  expect(s2.ok).toBe(true);
  expect(s2.level).toBe(2);
  expect(s2.verts).toBeGreaterThan(s1.verts); // each level is finer
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-subdivided.png') });

  // ── 3) Sculpt a bump at the top level + bake it. ───────────────────
  const bump = await win.evaluate((u) => {
    const scene = window.__archdiscScene;
    let mesh = null;
    scene.traverse((o) => { if (o.uuid === u) mesh = o; });
    const pos = mesh.geometry.attributes.position;
    const vIdx = 5;
    const before = [pos.getX(vIdx), pos.getY(vIdx), pos.getZ(vIdx)];
    pos.setX(vIdx, before[0] + 0.012); // push one vertex out
    pos.needsUpdate = true;
    return { before, vIdx };
  }, UUID);
  const bake = await win.evaluate((u) => window.__studioMultiresBake(u), UUID);
  expect(bake.ok).toBe(true);
  expect(bake.level).toBe(2);
  expect(bake.stored).toBe('detail');
  expect(bake.maxDisplacement).toBeGreaterThan(0.005);

  // ── 4) Step DOWN to level 0 (vert count drops to base). ────────────
  const down = await win.evaluate((u) => window.__studioMultiresSetLevel(u, 0), UUID);
  expect(down.ok).toBe(true);
  expect(down.level).toBe(0);
  expect(down.verts).toBe(baseVerts);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-level0.png') });

  // ── 5) Step back UP to level 2 — the bump must be PRESERVED. ───────
  const up = await win.evaluate((u) => window.__studioMultiresSetLevel(u, 2), UUID);
  expect(up.ok).toBe(true);
  expect(up.level).toBe(2);
  const preserved = await win.evaluate((args) => {
    const scene = window.__archdiscScene;
    let mesh = null;
    scene.traverse((o) => { if (o.uuid === args.u) mesh = o; });
    const pos = mesh.geometry.attributes.position;
    return [pos.getX(args.vIdx), pos.getY(args.vIdx), pos.getZ(args.vIdx)];
  }, { u: UUID, vIdx: bump.vIdx });
  // The X displacement (~0.012) survived the down→up round-trip.
  const dx = preserved[0] - bump.before[0];
  expect(dx).toBeGreaterThan(0.008);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '03-detail-preserved.png') });

  // ── 6) Stats report per-level vertex counts + stored detail. ───────
  const stats = await win.evaluate((u) => window.__studioMultiresStats(u), UUID);
  expect(stats.ok).toBe(true);
  expect(stats.levels).toBe(3);
  expect(stats.detailMag[2]).toBeGreaterThan(0); // detail at level 2

  // ── 7) Global search surfaces the multires ops. ───────────────────
  const search = await win.evaluate(() => window.__studioCommandSearch('multires', 40));
  expect(search.ok).toBe(true);
  const names = search.hits.map((h) => h.name);
  expect(names).toContain('__studioMultiresSubdivide');
  expect(names).toContain('__studioMultiresSetLevel');

  // ── 8) Camera sweep. ───────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 733: multires levels=3 baseVerts=', baseVerts,
    'L2 verts=', s2.verts, 'preserved bump dx=', (preserved[0] - bump.before[0]).toFixed(4));

  await app.close();
});
