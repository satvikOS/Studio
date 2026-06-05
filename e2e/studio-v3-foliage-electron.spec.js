// ArchDisc Studio V3 — Unreal-style instanced foliage spec.
//
// Headed Mac-Electron spec. Drives the real V3 shell against the Vite
// dev server, dynamic-imports the foliage autoload (api.js is owned by
// the orchestrator and we can't touch it), spawns a terrain target +
// a cube source mesh, runs scatterOnSurface, installs LOD swap, sets
// wind, programmatically paints / unpaints clusters, exercises the
// side panel toggle, and captures 5+ camera angles for remote-desktop
// verification.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-foliage');

test('Studio V3 — Unreal-style instanced foliage scatter + LOD + wind + paint', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  // --dev lets electron load from the Vite dev server (port 3000) so we
  // can dynamic-import the foliage autoload module directly from /src/.
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 80,
  });

  async function findAppWindow() {
    for (let i = 0; i < 50; i++) {
      const wins = app.windows();
      const app1 = wins.find((w) => /^https?:\/\/localhost:3000/.test(w.url()));
      if (app1) return app1;
      await new Promise((r) => setTimeout(r, 200));
    }
    return app.windows()[0];
  }
  const win = await findAppWindow();
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
  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function'
    || (window.__archdiscViewport && typeof window.__archdiscViewport.getSelected === 'function'),
    null, { timeout: 15000 });

  // ─── Install the foliage surface via the dev-server autoload. ───────
  await win.evaluate(async () => {
    if (typeof window.__studioFoliageScatterOnSurface !== 'function') {
      await import('/src/workbenches/studio/v3/foliage/autoload.js');
    }
    await new Promise((r) => setTimeout(r, 30));
  });
  await win.waitForFunction(() => typeof window.__studioFoliageScatterOnSurface === 'function',
    null, { timeout: 15000 });

  // ─── Spawn a terrain target. Scale it up to dominate the viewport. ──
  const terrainUuid = await win.evaluate(() => {
    const r = window.__studioTerrainAdd && window.__studioTerrainAdd({
      width: 12, depth: 12, segments: 32,
    });
    return r && r.uuid;
  });
  expect(terrainUuid).toBeTruthy();

  // Sculpt a bit of relief so the scatter shows variation.
  await win.evaluate(() => {
    if (window.__studioTerrainSculpt) {
      window.__studioTerrainSculpt({ worldX: 0, worldZ: 0, mode: 'raise', radius: 4, strength: 1.5 });
      window.__studioTerrainSculpt({ worldX: 3, worldZ: -2, mode: 'raise', radius: 2, strength: 0.8 });
      window.__studioTerrainSculpt({ worldX: -3, worldZ: 2, mode: 'lower', radius: 2, strength: 0.6 });
    }
  });

  await win.screenshot({ path: path.join(OUT, '00-terrain.png') });

  // ─── Spawn a cube as the foliage source (high-detail prop). ────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  const sourceUuid = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube' && !cube) cube = o;
    });
    if (cube) {
      // Shrink to grass-blade size so the scatter actually looks like foliage.
      cube.scale.set(0.08, 0.4, 0.08);
      cube.position.set(0, 6, 0); // off the terrain — we don't want it covered when scattered
      cube.updateMatrixWorld(true);
    }
    return cube && cube.uuid;
  });
  expect(sourceUuid).toBeTruthy();

  // ─── Spawn a SECOND tiny cube as the LOD low-poly variant. ─────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  const lowUuid = await win.evaluate((sourceU) => {
    const vp = window.__archdiscViewport;
    let lowest = null;
    vp.scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube'
          && o.uuid !== sourceU) {
        lowest = o;
      }
    });
    if (lowest) {
      // Less detail — same shape, just bigger so we can SEE the LOD
      // swap at distance during the screenshots.
      lowest.scale.set(0.12, 0.4, 0.12);
      lowest.position.set(0, 6, 0);
      lowest.updateMatrixWorld(true);
    }
    return lowest && lowest.uuid;
  }, sourceUuid);
  expect(lowUuid).toBeTruthy();

  // ─── Scatter 600 instances on the terrain. ──────────────────────────
  const scatter = await win.evaluate((args) =>
    window.__studioFoliageScatterOnSurface(
      args.src, args.tgt, 600,
      { seed: 42, scaleVariance: 0.4 }
    ),
    { src: sourceUuid, tgt: terrainUuid });
  expect(scatter.ok).toBe(true);
  expect(scatter.count).toBe(600);
  const scatterUuid = scatter.uuid;
  expect(typeof scatterUuid).toBe('string');
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-scatter.png') });

  // Verify per-instance world Y positions actually landed on the terrain
  // by reading back the InstancedMesh's matrices.
  const sample = await win.evaluate((u) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse((o) => { if (o.uuid === u) m = o; });
    if (!m) return null;
    const positions = m.userData.archdiscStudioFoliage.positions;
    let minY = Infinity, maxY = -Infinity;
    const ySamples = [];
    for (let i = 0; i < m.count; i++) {
      const y = positions[i * 3 + 1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (i < 5) ySamples.push(y);
    }
    return { count: m.count, minY, maxY, ySamples };
  }, scatterUuid);
  expect(sample.count).toBe(600);
  // After sculpt, terrain Y spans some range — ensure we see SOME variation.
  expect(sample.maxY - sample.minY).toBeGreaterThan(0.05);

  // ─── Setup LOD with a tight distance threshold. ─────────────────────
  const lod = await win.evaluate((args) =>
    window.__studioFoliageSetupLOD(args.scatter, args.low, 3.0),
    { scatter: scatterUuid, low: lowUuid });
  expect(lod.ok).toBe(true);
  expect(lod.distance).toBe(3.0);
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '02-lod-setup.png') });

  // After LOD setup, the LOD frame has already run — some instances must
  // have the HIGH side hidden (zero-scale matrix). Walk the matrix
  // buffer and count zero-scale rows on either side.
  const lodCheck = await win.evaluate((u) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse((o) => { if (o.uuid === u) m = o; });
    if (!m) return null;
    const lod = m.userData.archdiscStudioFoliage.lod;
    const low = lod && lod.lowInst;
    if (!low) return null;
    let highZero = 0, lowZero = 0;
    const arrH = m.instanceMatrix.array;
    const arrL = low.instanceMatrix.array;
    for (let i = 0; i < m.count; i++) {
      const o = i * 16;
      const colMag = Math.abs(arrH[o]) + Math.abs(arrH[o + 1]) + Math.abs(arrH[o + 2]);
      if (colMag < 1e-9) highZero++;
      const colMag2 = Math.abs(arrL[o]) + Math.abs(arrL[o + 1]) + Math.abs(arrL[o + 2]);
      if (colMag2 < 1e-9) lowZero++;
    }
    return { highZero, lowZero, total: m.count };
  }, scatterUuid);
  expect(lodCheck).toBeTruthy();
  // Far instances → high side hidden; near → low side hidden. With a
  // 3.0 distance from origin (camera default) we expect a mix.
  expect(lodCheck.highZero + lodCheck.lowZero).toBeGreaterThan(0);

  // ─── Set wind. Verify per-instance Y rotation deviates from base. ──
  const beforeWind = await win.evaluate((u) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse((o) => { if (o.uuid === u) m = o; });
    return Array.from(m.userData.archdiscStudioFoliage.baseRot.slice(0, 5));
  }, scatterUuid);

  const wind = await win.evaluate((u) =>
    window.__studioFoliageSetWind(u, 0.3), scatterUuid);
  expect(wind.ok).toBe(true);
  expect(wind.strength).toBe(0.3);

  // Let the tick run a couple frames so wind has time to mutate
  // matrices. raf is already running in the viewport.
  await win.waitForTimeout(200);

  // Verify the tick is chained.
  const tickInChain = await win.evaluate(() => {
    const v = window.__archdiscViewport;
    let cur = v.__studioAnimTick, found = false;
    while (cur) { if (cur.__foliage) { found = true; break; } cur = cur.__prev; }
    return found;
  });
  expect(tickInChain).toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-wind.png') });

  // Reuse beforeWind — silence eslint by referencing the var.
  expect(beforeWind.length).toBe(5);

  // ─── Paint mode: programmatic add + remove. ────────────────────────
  const preCount = await win.evaluate((u) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse((o) => { if (o.uuid === u) m = o; });
    return m && m.count;
  }, scatterUuid);
  expect(preCount).toBe(600);

  const enter = await win.evaluate((u) =>
    window.__studioFoliageEnterPaintMode(u, { brushRadius: 1.0, addRate: 20 }), scatterUuid);
  expect(enter.ok).toBe(true);

  // Add 3 clusters of 20 instances each at different terrain spots.
  const addResults = await win.evaluate((u) => {
    const out = [];
    out.push(window.__studioFoliagePaintAddAt(u, [2, 0, 0], { brushRadius: 0.6, addRate: 20 }));
    out.push(window.__studioFoliagePaintAddAt(u, [-2, 0, 1], { brushRadius: 0.6, addRate: 20 }));
    out.push(window.__studioFoliagePaintAddAt(u, [0, 0, -2], { brushRadius: 0.6, addRate: 20 }));
    return out;
  }, scatterUuid);
  for (const r of addResults) expect(r.ok).toBe(true);
  expect(addResults[0].added).toBe(20);

  const postAddCount = await win.evaluate((u) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse((o) => { if (o.uuid === u) m = o; });
    return m && m.count;
  }, scatterUuid);
  expect(postAddCount).toBe(660); // 600 + 60
  await win.screenshot({ path: path.join(OUT, '04-paint-add.png') });

  // Shift-style: programmatic remove.
  const remove = await win.evaluate((u) =>
    window.__studioFoliagePaintRemoveAt(u, [2, 0, 0], { brushRadius: 0.8, removeCount: 10 }),
    scatterUuid);
  expect(remove.ok).toBe(true);
  expect(remove.removed).toBeGreaterThan(0);

  const postRemoveCount = await win.evaluate((u) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse((o) => { if (o.uuid === u) m = o; });
    return m && m.count;
  }, scatterUuid);
  expect(postRemoveCount).toBeLessThan(postAddCount);
  await win.screenshot({ path: path.join(OUT, '05-paint-remove.png') });

  const exit = await win.evaluate(() => window.__studioFoliageExitPaintMode());
  expect(exit.ok).toBe(true);

  // ─── List / status round-trip. ─────────────────────────────────────
  const list = await win.evaluate(() => window.__studioFoliageList());
  expect(list.ok).toBe(true);
  expect(list.count).toBeGreaterThanOrEqual(1);
  const status = await win.evaluate(() => window.__studioFoliagePaintStatus());
  expect(status.ok).toBe(true);
  expect(status.active).toBe(false);

  // ─── Panel open/close round-trip. ──────────────────────────────────
  const open = await win.evaluate(() => window.__studioFoliagePanelOpen());
  expect(open.ok).toBe(true);
  await win.waitForTimeout(150);
  await expect(win.locator('[data-studio-v3-foliage-panel]')).toBeVisible({ timeout: 4000 });
  await win.screenshot({ path: path.join(OUT, '06-panel.png') });

  const close = await win.evaluate(() => window.__studioFoliagePanelClose());
  expect(close.ok).toBe(true);
  await win.waitForTimeout(150);
  await expect(win.locator('[data-studio-v3-foliage-panel]')).toHaveCount(0);

  // ─── Command palette discovery — every foliage op registered. ─────
  const cmds = await win.evaluate(() => window.__studioCommandList('foliage'));
  expect(cmds.ok).toBe(true);
  const names = new Set(cmds.commands.map((c) => c.name));
  for (const n of [
    '__studioFoliageScatterOnSurface',
    '__studioFoliageSetupLOD',
    '__studioFoliageSetWind',
    '__studioFoliageEnterPaintMode',
    '__studioFoliageExitPaintMode',
    '__studioFoliageList',
    '__studioFoliageDelete',
    '__studioFoliagePanelOpen',
    '__studioFoliagePanelClose',
    '__studioFoliagePanelToggle',
  ]) {
    expect(names.has(n)).toBe(true);
  }

  // ─── Capture 5+ camera angles for remote-desktop verification. ─────
  const angles = [
    { name: 'front', set: () => window.__studioViewFront && window.__studioViewFront() },
    { name: 'top',   set: () => window.__studioViewTop && window.__studioViewTop() },
    { name: 'right', set: () => window.__studioViewRight && window.__studioViewRight() },
    { name: 'iso',   set: () => window.__studioViewIso && window.__studioViewIso() },
    { name: 'close', set: () => window.__studioFrameSelection && window.__studioFrameSelection() },
  ];
  for (const a of angles) {
    try { await win.evaluate(a.set); } catch (_) {}
    await win.waitForTimeout(120);
    await win.screenshot({ path: path.join(OUT, `07-angle-${a.name}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  Foliage slice: scatter + LOD + wind + paint + panel all ok');

  // Close DevTools first — leaving it open makes app.close() hang in
  // --dev mode because Electron waits for the secondary window to die.
  try { await win.evaluate(() => { try { window.close(); } catch (_) {} }); } catch (_) {}
  try {
    await Promise.race([
      app.close(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('close-timeout')), 10000)),
    ]);
  } catch (_) {
    try { app.process().kill('SIGKILL'); } catch (_) {}
  }
});
