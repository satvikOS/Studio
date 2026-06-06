// ArchDisc Studio V3 — MagicaVoxel-style bulk shape tools (slice 741).
//
// Headed Mac-Electron spec. Adds the four bulk voxel edit ops every voxel
// editor (MagicaVoxel / Goxel / Qubicle) ships and this module lacked
// (it had only single-cell set/get): box, line, sphere, flood-fill.
//
// Verifies through the real voxel volume + scene mesh rebuild:
//   • __studioVoxelBox fills an exact 4×4×4 = 64-cell box
//   • __studioVoxelLine lays a continuous diagonal (count = max-delta+1)
//   • __studioVoxelSphere fills a centred, symmetric solid sphere
//   • __studioVoxelFill flood-fills a bounded empty region
//   • each rebuilds a real mesh in the scene (triangle count > 0)
//   • global search surfaces the new ops
//   • camera sweep

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-voxshapes');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — voxel bulk shape tools', async () => {
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
    if (typeof window.__studioVoxelBox !== 'function') {
      await import('/src/workbenches/studio/v3/voxel/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioVoxelBox === 'function',
    null, { timeout: 20000 });
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // Fresh 32³ volume for all shape tests.
  await win.evaluate(() => window.__studioVoxelCreate(32, 32, 32, 1));

  // ── 1) Box: 0..3 cubed = 64 cells. ────────────────────────────────
  const box = await win.evaluate(() => {
    window.__studioVoxelClear();
    const r = window.__studioVoxelBox(0, 0, 0, 3, 3, 3, 1);
    const stats = window.__studioVoxelGetStats();
    return { r, filled: stats.voxels };
  });
  console.log('[vox] box changed', box.r.changed, 'filled', box.filled);
  expect(box.r.ok).toBe(true);
  expect(box.r.changed).toBe(64);
  expect(box.filled).toBe(64);

  // ── 2) Line: diagonal (0,0,0)→(10,10,10) → 11 cells. ──────────────
  const line = await win.evaluate(() => {
    window.__studioVoxelClear();
    const r = window.__studioVoxelLine(0, 0, 0, 10, 10, 10, 2);
    return { r, filled: window.__studioVoxelGetStats().voxels };
  });
  console.log('[vox] line changed', line.r.changed, 'filled', line.filled);
  expect(line.r.ok).toBe(true);
  expect(line.filled).toBe(11); // max delta (10) + 1

  // ── 3) Sphere: centred + symmetric solid ball. ───────────────────
  const sph = await win.evaluate(() => {
    window.__studioVoxelClear();
    const r = window.__studioVoxelSphere(16, 16, 16, 4, 3);
    return {
      r,
      filled: window.__studioVoxelGetStats().voxels,
      center: window.__studioVoxelGet(16, 16, 16).idx,
      farCorner: window.__studioVoxelGet(20, 20, 20).idx, // dist²=48 > (4.5)²=20.25
      onAxis: window.__studioVoxelGet(20, 16, 16).idx,    // dist=4 ≤ radius → filled
    };
  });
  console.log('[vox] sphere filled', sph.filled, 'center', sph.center, 'corner', sph.farCorner, 'axis', sph.onAxis);
  expect(sph.r.ok).toBe(true);
  expect(sph.center).toBe(3);      // centre filled
  expect(sph.farCorner).toBe(0);   // diagonal corner outside radius
  expect(sph.onAxis).toBe(3);      // on-axis at exactly radius is filled
  expect(sph.filled).toBeGreaterThan(150);

  // ── 4) Fill (flood bucket): bound empty region → whole grid. ─────
  const fill = await win.evaluate(() => {
    window.__studioVoxelClear();
    // Empty 32³ → flood from (0,0,0) replacing 0→4 fills all 32768 cells.
    const r = window.__studioVoxelFill(0, 0, 0, 4);
    return { r, filled: window.__studioVoxelGetStats().voxels };
  });
  console.log('[vox] fill changed', fill.r.changed, 'filled', fill.filled);
  expect(fill.r.ok).toBe(true);
  expect(fill.filled).toBe(32 * 32 * 32);

  // ── 5) Real mesh in the scene after a shape op. ──────────────────
  const mesh = await win.evaluate(() => {
    window.__studioVoxelClear();
    window.__studioVoxelBox(0, 0, 0, 5, 5, 5, 1);
    const uuid = window.__studioVoxelGetActiveMeshUuid().uuid;
    const scene = window.__archdiscScene;
    const m = scene.getObjectByProperty('uuid', uuid);
    let tris = 0;
    if (m && m.geometry) {
      const g = m.geometry;
      tris = g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
    }
    return { hasMesh: !!m, tris };
  });
  console.log('[vox] scene mesh tris', mesh.tris);
  expect(mesh.hasMesh).toBe(true);
  expect(mesh.tris).toBeGreaterThan(0);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-box-mesh.png') });

  // ── 6) Global search surfaces the new ops. ───────────────────────
  const search = await win.evaluate(() => {
    const r = window.__studioCommandSearch('voxel sphere', 60);
    return { ok: r.ok, names: (r.hits || []).map((h) => h.name) };
  });
  console.log('[vox] search hits:', JSON.stringify(search.names.slice(0, 6)));
  expect(search.ok).toBe(true);
  expect(search.names.some((n) => /VoxelSphere/i.test(n))).toBe(true);

  // ── 7) Camera sweep. ───────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 741: box 64, line 11, sphere', sph.filled, ', fill', fill.filled, '| mesh tris', mesh.tris);

  await app.close();
});
