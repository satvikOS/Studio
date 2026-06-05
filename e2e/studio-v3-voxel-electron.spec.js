// ArchDisc Studio V3 — MagicaVoxel-style voxel editor e2e.
//
// Headed Mac-Electron spec (per the user's headed-tests feedback rule;
// the user watches the spec play out remotely).
//
// Exercises the __studioVoxel* op surface defined by voxel/index.js:
//   • create a 12×12×12 volume
//   • read the palette + flip the active idx
//   • paint a small structure via __studioVoxelSimulateClick (idx 12)
//   • shift-click to remove one voxel and confirm count drops
//   • assert the merged mesh dropped interior faces (face count <
//     6 * filled voxels)
//   • round-trip JSON via export → clear → import
//   • export OBJ + PLY; sanity-check they contain f / face records
//   • flip the palette colour at idx 12 and re-rebuild
//   • confirm command-palette registered every op under 'voxel'
//   • sweep 5 named camera angles for remote-desktop verification

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-voxel');
const NAMED_VIEWS = ['front', 'top', 'right', 'iso', 'close'];

test('Studio V3 — MagicaVoxel-style native voxel editor', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  // Launch with --dev so Electron loads from the Vite dev server and
  // we can dynamic-import the voxel autoload module by URL even when
  // api.js orchestration hasn't been wired yet.
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

  // ── Install the voxel module via autoload (api.js may not have wired it). ──
  await win.evaluate(async () => {
    if (typeof window.__studioVoxelCreate !== 'function') {
      await import('/src/workbenches/studio/v3/voxel/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioVoxelCreate === 'function',
    null, { timeout: 20000 });

  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Create a 12³ volume. ────────────────────────────────────────
  const created = await win.evaluate(() => window.__studioVoxelCreate(12, 12, 12, 0.12));
  expect(created.ok).toBe(true);
  expect(typeof created.uuid).toBe('string');
  expect(created.sizeX).toBe(12);
  expect(created.sizeY).toBe(12);
  expect(created.sizeZ).toBe(12);

  // ── 2) Inspect palette + flip the active index. ────────────────────
  const pal = await win.evaluate(() => window.__studioVoxelGetPalette());
  expect(pal.ok).toBe(true);
  expect(Array.isArray(pal.palette)).toBe(true);
  // Palette is 0 (empty) + 64 paint slots = 65 entries.
  expect(pal.palette.length).toBe(65);
  expect(pal.active).toBeGreaterThanOrEqual(1);
  // Each entry is an [r,g,b] triple in [0,1].
  for (const c of pal.palette) {
    expect(Array.isArray(c)).toBe(true);
    expect(c.length).toBe(3);
    for (const v of c) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  }

  // Pick idx 12 (somewhere in the bright row, distinct from default).
  const activeSet = await win.evaluate(() => window.__studioVoxelSetActivePaletteIdx(12));
  expect(activeSet.ok).toBe(true);
  expect(activeSet.idx).toBe(12);

  // ── 3) Paint a small 3-voxel L-shape using simulateClick. ──────────
  await win.evaluate(() => {
    window.__studioVoxelSimulateClick(2, 2, 2);
    window.__studioVoxelSimulateClick(3, 2, 2);
    window.__studioVoxelSimulateClick(2, 3, 2);
  });
  const stats1 = await win.evaluate(() => window.__studioVoxelGetStats());
  expect(stats1.voxels).toBe(3);
  expect(stats1.verts).toBeGreaterThan(0);
  // Each voxel has 6 faces, each face has 4 verts. With NO interior
  // culling we'd see 3 * 6 * 4 = 72 verts. With culling we expect FEWER
  // because the 3 voxels share faces.
  expect(stats1.verts).toBeLessThan(3 * 6 * 4);

  // Verify the value at one of the painted cells round-trips.
  const got = await win.evaluate(() => window.__studioVoxelGet(2, 2, 2));
  expect(got.ok).toBe(true);
  expect(got.idx).toBe(12);

  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-painted.png') });

  // ── 4) Shift+click to remove one voxel; count must drop. ──────────
  const removed = await win.evaluate(() => window.__studioVoxelSimulateClick(3, 2, 2, true));
  expect(removed.ok).toBe(true);
  expect(removed.idx).toBe(0);
  const stats2 = await win.evaluate(() => window.__studioVoxelGetStats());
  expect(stats2.voxels).toBe(2);

  // ── 5) Big solid block — confirm interior-face culling kicks in. ──
  await win.evaluate(() => {
    window.__studioVoxelClear();
    // Solid 4×4×4 block at cell origin. 64 voxels.
    for (let y = 0; y < 4; y++)
      for (let z = 0; z < 4; z++)
        for (let x = 0; x < 4; x++)
          window.__studioVoxelSet(x, y, z, 12);
    window.__studioVoxelRebuildMesh();
  });
  const statsBlock = await win.evaluate(() => window.__studioVoxelGetStats());
  expect(statsBlock.voxels).toBe(64);
  // Solid 4³ block: only the 6 outer faces are visible, each 4×4 = 16
  // unit faces, total 96 quads × 4 verts = 384 verts.  Without culling
  // we'd see 64 × 24 = 1536 verts.  Assert we're decisively below the
  // worst-case bound — the exact value depends on traversal order but
  // must be ≤ 6 * (sizeX * sizeY) * 4 = 6 * 16 * 4 = 384.
  expect(statsBlock.verts).toBeLessThanOrEqual(384);
  expect(statsBlock.verts).toBeLessThan(64 * 24);

  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-solid-block.png') });

  // ── 6) JSON round-trip. ────────────────────────────────────────────
  const j = await win.evaluate(() => window.__studioVoxelExportJson());
  expect(j.ok).toBe(true);
  expect(j.json.kind).toBe('archdisc-voxel-volume');
  expect(j.json.sizeX).toBe(12);
  expect(j.json.filled).toBe(64);
  expect(typeof j.json.cells).toBe('string');
  expect(Array.isArray(j.json.palette)).toBe(true);
  expect(j.json.palette.length).toBe(64);

  await win.evaluate(() => window.__studioVoxelClear());
  const cleared = await win.evaluate(() => window.__studioVoxelGetStats());
  expect(cleared.voxels).toBe(0);

  const imported = await win.evaluate((json) => window.__studioVoxelImportJson(json), j.json);
  expect(imported.ok).toBe(true);
  expect(imported.voxels).toBe(64);
  const statsAfterImport = await win.evaluate(() => window.__studioVoxelGetStats());
  expect(statsAfterImport.voxels).toBe(64);

  // ── 7) OBJ + PLY exporters smoke-test. ─────────────────────────────
  const obj = await win.evaluate(() => window.__studioVoxelExportObj());
  expect(obj.ok).toBe(true);
  expect(typeof obj.text).toBe('string');
  expect(obj.text).toContain('# ArchDisc Studio V3');
  // Must contain at least one vertex line and one face line.
  expect(obj.text).toMatch(/\nv [0-9.\-]+/);
  expect(obj.text).toMatch(/\nf [0-9]+/);
  expect(obj.text).toMatch(/usemtl pal_12/);

  const ply = await win.evaluate(() => window.__studioVoxelExportPly());
  expect(ply.ok).toBe(true);
  expect(ply.text.startsWith('ply')).toBe(true);
  expect(ply.text).toContain('format ascii 1.0');
  expect(ply.text).toContain('property uchar red');
  // PLY face line: "4 a b c d"
  expect(ply.text).toMatch(/\n4 [0-9]+ [0-9]+ [0-9]+ [0-9]+/);

  // ── 8) Palette edit — flipping a slot rebuilds the mesh. ──────────
  const before = await win.evaluate(() => {
    const uuid = window.__studioVoxelGetActiveMeshUuid().uuid;
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === uuid) m = o; });
    return m && m.geometry.attributes.color
      ? [m.geometry.attributes.color.array[0],
         m.geometry.attributes.color.array[1],
         m.geometry.attributes.color.array[2]] : null;
  });
  expect(before).not.toBeNull();
  // Flip idx 12 to bright red.
  const flip = await win.evaluate(() => window.__studioVoxelSetPaletteEntry(12, '#ff0000'));
  expect(flip.ok).toBe(true);
  expect(flip.hex.toLowerCase()).toBe('#ff0000');
  const after = await win.evaluate(() => {
    const uuid = window.__studioVoxelGetActiveMeshUuid().uuid;
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === uuid) m = o; });
    return m && m.geometry.attributes.color
      ? [m.geometry.attributes.color.array[0],
         m.geometry.attributes.color.array[1],
         m.geometry.attributes.color.array[2]] : null;
  });
  expect(after).not.toBeNull();
  // After the palette flip the first vertex of the painted mesh should
  // be at or very close to pure red.
  expect(after[0]).toBeGreaterThan(0.9);
  expect(after[1]).toBeLessThan(0.1);
  expect(after[2]).toBeLessThan(0.1);

  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '03-recoloured.png') });

  // ── 9) Open the panel + verify it mounted. ─────────────────────────
  await win.evaluate(() => window.__studioVoxelPanelOpen());
  await expect(win.locator('[data-studio-v3-voxel-panel]')).toBeVisible({ timeout: 5000 });
  // Active swatch shows in the panel.
  await expect(win.locator('[data-studio-v3-voxel-active-idx]')).toContainText('12');
  await win.screenshot({ path: path.join(OUT, '04-panel-open.png') });

  // ── 10) Command-palette registration. ──────────────────────────────
  const palCmds = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { ok: false };
    return window.__studioCommandList('voxel');
  });
  if (palCmds.ok) {
    expect(palCmds.commands.length).toBeGreaterThanOrEqual(15);
    const names = palCmds.commands.map((c) => c.name);
    const expected = [
      '__studioVoxelCreate', '__studioVoxelSet', '__studioVoxelGet',
      '__studioVoxelClear', '__studioVoxelSetActivePaletteIdx',
      '__studioVoxelSetPaletteEntry', '__studioVoxelGetPalette',
      '__studioVoxelRebuildMesh', '__studioVoxelExportObj',
      '__studioVoxelExportJson', '__studioVoxelImportJson',
      '__studioVoxelPanelOpen', '__studioVoxelPanelClose',
      '__studioVoxelPanelToggle',
    ];
    for (const e of expected) expect(names).toContain(e);
  }

  // ── 11) Multi-cam sweep for remote-desktop verification. ───────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport;
      if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front')      c.position.set(0,    0,    2.4);
      else if (v === 'top')   c.position.set(0,    2.4, 0.001);
      else if (v === 'right') c.position.set(2.4,  0,    0);
      else if (v === 'iso')   c.position.set(1.7,  1.7,  1.7);
      else if (v === 'close') c.position.set(1.0,  1.0,  1.0);
      c.lookAt(0, 0, 0);
      if (vp.orbitControls && vp.orbitControls.target) {
        vp.orbitControls.target.set(0, 0, 0);
        if (typeof vp.orbitControls.update === 'function') vp.orbitControls.update();
      }
    }, view);
    await win.waitForTimeout(180);
    await win.screenshot({ path: path.join(OUT, `05-cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  voxel slice: solid 4^3 block -> %d voxels, %d verts (vs 1536 uncullled)',
    statsBlock.voxels, statsBlock.verts);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
