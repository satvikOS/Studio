// ArchDisc Studio V3 — sparse VDB-style tile bookkeeping (slice 751).
//
// Headed Mac-Electron spec. Verifies the pure-JS sparse-tile store that
// sits beside the slice 730–731 dense pyro grid. The dense pyro path is
// not touched here — sparseVDB is a parallel backing store.
//
// Checks:
//   • __studioVDBCreate installs a fresh store with tileSize 8.
//   • Setting 100 voxels in a 4×5×5 cluster centred at (10,10,10) keeps
//     the active tile count in [1,4] (cluster fits in tile coord (1,1,1)
//     and at most spills to four diagonal-neighbour tiles) while the
//     active voxel count is exactly 100.
//   • Writing a single far voxel at (9999,9999,9999) grows the active
//     tile count by exactly one (new tile allocated on first nonzero
//     write).
//   • Get round-trip on the far voxel returns ≈1.0.
//   • Overwriting the far voxel with 0.01 and pruning at threshold 0.1
//     drops exactly that tile (the cluster tile's per-tile max stays at
//     1.0 and survives).
//   • __studioVDBList enumerates exactly ['s'].
//   • Five named camera angles captured for the remote-desktop reviewer.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-vdb-sparse');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — sparse VDB-style tile bookkeeping', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });
  // --dev may auto-open a DevTools window; pick the real app window.
  let win = null;
  for (let i = 0; i < 30 && !win; i++) {
    win = app.windows().find((w) => {
      const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
      return u && !u.startsWith('devtools://');
    }) || null;
    if (!win) { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!win) win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });

  let shellUp = false;
  for (let attempt = 0; attempt < 4 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1500);
    try {
      await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 40000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 30000 });

  await win.evaluate(async () => {
    if (typeof window.__studioVDBCreate !== 'function') {
      await import('/src/workbenches/studio/v3/volume/autoload-vdb.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioVDBCreate === 'function',
    null, { timeout: 20000 });
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Create a fresh store. ───────────────────────────────────────
  const created = await win.evaluate(() => window.__studioVDBCreate('s', 8));
  console.log('[vdb] create', JSON.stringify(created));
  expect(created.ok).toBe(true);
  expect(created.name).toBe('s');
  expect(created.tileSize).toBe(8);

  // ── 2) Cluster of 100 voxels (4×5×5) centred at (10,10,10). ───────
  //   x ∈ {8,9,10,11}, y ∈ {8,9,10,11,12}, z ∈ {8,9,10,11,12} → all in
  //   tile coord (1,1,1) with tileSize=8 → 1 tile.
  const cluster = await win.evaluate(() => {
    for (let dx = 0; dx < 4; dx++) {
      for (let dy = 0; dy < 5; dy++) {
        for (let dz = 0; dz < 5; dz++) {
          const x = 8 + dx;
          const y = 8 + dy;
          const z = 8 + dz;
          window.__studioVDBSet('s', x, y, z, 1.0);
        }
      }
    }
    return window.__studioVDBStats('s');
  });
  console.log('[vdb] cluster stats', JSON.stringify(cluster));
  expect(cluster.ok).toBe(true);
  expect(cluster.activeTileCount).toBeGreaterThanOrEqual(1);
  expect(cluster.activeTileCount).toBeLessThanOrEqual(4);
  expect(cluster.activeVoxelCount).toBe(100);

  const tilesBeforeFar = cluster.activeTileCount;

  // ── 3) Far voxel: grows the active tile count by exactly one. ────
  const far = await win.evaluate(() => {
    window.__studioVDBSet('s', 9999, 9999, 9999, 1.0);
    return window.__studioVDBStats('s');
  });
  console.log('[vdb] far stats', JSON.stringify(far));
  expect(far.ok).toBe(true);
  expect(far.activeTileCount).toBe(tilesBeforeFar + 1);

  // ── 4) Get round-trip on the far voxel. ──────────────────────────
  const got = await win.evaluate(() => window.__studioVDBGet('s', 9999, 9999, 9999));
  console.log('[vdb] get', JSON.stringify(got));
  expect(got.ok).toBe(true);
  expect(got.v).toBeGreaterThan(0.99);
  expect(got.v).toBeLessThan(1.01);

  await win.screenshot({ path: path.join(OUT, '01-after-set.png') });

  // ── 5) Overwrite far voxel low + prune drops that tile. ──────────
  const pruned = await win.evaluate(() => {
    window.__studioVDBSet('s', 9999, 9999, 9999, 0.01);
    const before = window.__studioVDBStats('s').activeTileCount;
    const r = window.__studioVDBPrune('s', 0.1);
    const after = window.__studioVDBStats('s').activeTileCount;
    return { r, before, after };
  });
  console.log('[vdb] prune', JSON.stringify(pruned));
  expect(pruned.r.ok).toBe(true);
  expect(pruned.after).toBe(pruned.before - 1);

  // ── 6) List returns ['s']. ───────────────────────────────────────
  const list = await win.evaluate(() => window.__studioVDBList());
  console.log('[vdb] list', JSON.stringify(list));
  expect(list.ok).toBe(true);
  expect(list.names).toContain('s');
  expect(list.names.length).toBe(1);

  // ── 7) Camera sweep. ─────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 751: cluster tiles', tilesBeforeFar, ', far stats tiles', far.activeTileCount,
    ', prune removed', pruned.r.removed, ', kept', pruned.r.kept);

  await app.close();
});
