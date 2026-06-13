import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

// Slice 961 — parity ledger #5: chained corner resolution for Bevel
// Edges (Maya corner-bevel fillet). Beveling the three cube edges that
// meet at a corner must fan-fill the corner hole: cornerFaces > 0 and
// strictly fewer boundary edges than the legacy per-edge result.

test('Studio slice 961 — bevel chained-corner resolution', async () => {
  test.setTimeout(120000);
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: 100,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => {
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioMeshBevelEdges === 'function',
    null, { timeout: 10000 });

  const result = await win.evaluate(async () => {
    const boundaryEdges = (geom) => {
      const idx = geom.index.array;
      const m = new Map();
      for (let f = 0; f < idx.length / 3; f++) {
        const t = [idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]];
        for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
          const k = Math.min(a, b) + '_' + Math.max(a, b);
          m.set(k, (m.get(k) || 0) + 1);
        }
      }
      let n = 0;
      for (const c of m.values()) if (c === 1) n++;
      return n;
    };

    // Helper: find the 3 mesh edges that meet at the +X+Y+Z corner of a
    // fresh cube by geometric position (robust to index layout).
    const cornerEdgesOf = (mesh) => {
      const pos = mesh.geometry.attributes.position;
      const idx = mesh.geometry.index.array;
      let corner = -1, best = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const s = pos.getX(i) + pos.getY(i) + pos.getZ(i);
        if (s > best) { best = s; corner = i; }
      }
      const at = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)];
      const c = at(corner);
      const pairs = new Set();
      for (let f = 0; f < idx.length / 3; f++) {
        const t = [idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]];
        if (!t.includes(corner)) continue;
        for (const v of t) {
          if (v === corner) continue;
          const p = at(v);
          // geometric cube edge: differs from the corner along exactly ONE axis
          const d = [Math.abs(p[0] - c[0]) > 1e-6, Math.abs(p[1] - c[1]) > 1e-6, Math.abs(p[2] - c[2]) > 1e-6];
          if (d.filter(Boolean).length === 1) pairs.add(Math.min(corner, v) + ',' + Math.max(corner, v));
        }
      }
      return { corner, edges: Array.from(pairs).map((k) => k.split(',').map(Number)) };
    };

    // Legacy run. Spawned BoxGeometry has split vertices (24) — weld
    // first so geometric cube edges are real manifold index pairs
    // (the slice-957 lesson).
    window.__spawnPrimitive('cube', window.__archdiscScene);
    window.__studioSelectNewest();
    const m1 = window.__studioSelectedMesh();
    // mergeVertices only welds verts whose EVERY attribute matches —
    // box corners carry per-face normals/uvs, so strip them first
    // (the slice-957 manifold lesson). Bevel recomputes normals after.
    m1.geometry.deleteAttribute('normal'); m1.geometry.deleteAttribute('uv');
    await window.__studioGeometryRepairWeld(1e-4);
    const e1 = cornerEdgesOf(m1);
    const legacy = window.__studioMeshBevelEdges(m1.uuid, e1.edges, 0.005, { cornerResolution: false });
    const legacyBoundary = boundaryEdges(m1.geometry);

    // Corner-resolution run.
    window.__spawnPrimitive('cube', window.__archdiscScene);
    window.__studioSelectNewest();
    const m2 = window.__studioSelectedMesh();
    m2.geometry.deleteAttribute('normal'); m2.geometry.deleteAttribute('uv');
    await window.__studioGeometryRepairWeld(1e-4);
    const e2 = cornerEdgesOf(m2);
    const corner = window.__studioMeshBevelEdges(m2.uuid, e2.edges, 0.005);
    const cornerBoundary = boundaryEdges(m2.geometry);

    return { legacy, corner, legacyBoundary, cornerBoundary, edgeCounts: [e1.edges.length, e2.edges.length] };
  });

  expect(result.edgeCounts[0]).toBeGreaterThanOrEqual(3);
  expect(result.legacy.ok).toBe(true);
  expect(result.corner.ok).toBe(true);
  expect(result.corner.beveled).toBeGreaterThanOrEqual(3);
  expect(result.corner.cornerFaces).toBeGreaterThan(0);
  expect(result.cornerBoundary).toBeLessThan(result.legacyBoundary);

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
