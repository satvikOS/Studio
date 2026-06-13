import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

// Slice 960 — parity ledger #6: user-painted UV seam workflow (Blender
// Ctrl+E "Mark Seam" → unwrap honours marked seams). Paint a 4-edge
// loop on a cube via __studioMarkEdgeSeam, unwrap with markedOnly, and
// the cut must follow the PAINTED loop (2 charts), not the 40° auto
// detection (6 charts). Marked keys are cleared after the cut because
// the rebuild renumbers vertices.

test('Studio slice 960 — painted seams drive the unwrap cut', async () => {
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
  await win.waitForFunction(() => typeof window.__studioZUVMasterUnwrapWithSeams === 'function'
    && typeof window.__studioMarkEdgeSeam === 'function', null, { timeout: 10000 });

  const result = await win.evaluate(async () => {
    // mergeVertices only welds verts whose EVERY attribute matches —
    // strip per-face normals/uvs first so the cube becomes a real
    // 8-vert closed mesh (the slice-957 manifold lesson).
    const weld = async (mesh) => {
      mesh.geometry.deleteAttribute('normal');
      mesh.geometry.deleteAttribute('uv');
      await window.__studioGeometryRepairWeld(1e-4);
    };

    window.__spawnPrimitive('cube', window.__archdiscScene);
    window.__studioSelectNewest();
    const mesh = window.__studioSelectedMesh();
    await weld(mesh);

    // Baseline: auto angle-cut on a welded cube → 6 face charts.
    const baseline = window.__studioZUVMasterUnwrapWithSeams(mesh.uuid, { seamAngleDeg: 40 });

    // Fresh cube for the painted run.
    window.__spawnPrimitive('cube', window.__archdiscScene);
    window.__studioSelectNewest();
    const mesh2 = window.__studioSelectedMesh();
    await weld(mesh2);

    // Paint the TOP-FACE RING: the 4 edges between the 4 highest verts
    // form a closed loop — painted-only cutting along it must give
    // exactly 2 charts (top cap + the rest), vs 6 from auto detection.
    const pos = mesh2.geometry.attributes.position;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
    const top = [];
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) - maxY) < 1e-6) top.push(i);
    const ringPairs = [];
    for (let a = 0; a < top.length; a++) {
      for (let b = a + 1; b < top.length; b++) {
        const i = top[a], j = top[b];
        const dx = Math.abs(pos.getX(i) - pos.getX(j)) > 1e-6;
        const dz = Math.abs(pos.getZ(i) - pos.getZ(j)) > 1e-6;
        if (dx !== dz) ringPairs.push([i, j]); // differs on exactly one axis
      }
    }
    const edges = window.__studioListEdges(mesh2.uuid);
    const seamIdx = [];
    edges.forEach((e, idx) => {
      if (ringPairs.some(([a, b]) =>
        (e.fromVertIdx === a && e.toVertIdx === b) || (e.fromVertIdx === b && e.toVertIdx === a))) {
        seamIdx.push(idx);
      }
    });
    for (const i of seamIdx) window.__studioMarkEdgeSeam(mesh2.uuid, i, true);
    const markedCount = mesh2.userData.studioSeamEdges
      ? mesh2.userData.studioSeamEdges.size : 0;

    const painted = window.__studioZUVMasterUnwrapWithSeams(mesh2.uuid, { markedOnly: true });
    const clearedAfter = mesh2.userData.studioSeamEdges
      ? mesh2.userData.studioSeamEdges.size : 0;

    return { baseline, painted, markedCount, clearedAfter, ringEdges: seamIdx.length,
             hasUv: !!mesh2.geometry.attributes.uv };
  });

  expect(result.baseline.ok).toBe(true);
  expect(result.baseline.charts).toBeGreaterThanOrEqual(6);

  expect(result.ringEdges).toBe(4);
  expect(result.markedCount).toBe(4);
  expect(result.painted.ok).toBe(true);
  expect(result.painted.paintedUsed).toBe(4);
  // markedOnly along a closed top ring: exactly 2 charts (cap + rest),
  // vs 6 from the 40° auto detection.
  expect(result.painted.charts).toBe(2);
  expect(result.painted.charts).toBeLessThan(result.baseline.charts);
  expect(result.hasUv).toBe(true);
  expect(result.clearedAfter).toBe(0);

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
