import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 76 — Blender Wireframe modifier.
 *
 * Blender source: blender/source/blender/modifiers/intern/MOD_wireframe.cc
 *
 * Every unique edge of the selected mesh becomes a thin cylinder.
 * Test on an icosahedron — 30 unique edges -> 30 cylinders -> merged
 * into one geometry.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-wireframe');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

test('Studio Blender Wireframe — every edge becomes a thin cylinder', async () => {
  test.setTimeout(120000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 220,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Stage: icosahedron (12 vert, 20 tri, 30 unique edges).
  await win.locator('[data-studio-primitive="icosahedron"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'icosahedron');
  await win.waitForTimeout(300);

  // First Loop-subdivide (gives proper indexed mesh) then wireframe.
  // Loop-subdivide also gives more edges (icosahedron after Loop has
  // 42 verts, 80 tris, 120 edges).
  await win.locator('[data-studio-ribbon-action="loop-subdivide"]').click();
  await win.waitForTimeout(400);

  await win.locator('[data-studio-ribbon-action="wireframe-mod"]').click();
  await win.waitForTimeout(500);

  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'icosahedron') m = o; });
    if (!m) return null;
    return {
      verts: m.geometry.attributes.position.count,
      wireframed: m.userData.archdiscStudioWireframed || 0,
      edgeCount: m.userData.archdiscStudioWireframeEdges || 0,
    };
  });
  expect(state).not.toBeNull();
  expect(state.wireframed).toBe(1);
  // Loop-subdivided icosa: V=42, E=120 (Euler's formula on subdivided
  // icosa). Each edge -> a 6-segment cylinder (12 verts per cylinder).
  expect(state.edgeCount).toBe(120);
  // Each edge -> one CylinderGeometry. Vert count is edges *
  // per-cylinder-vert-count (varies with three.js version).
  expect(state.verts).toBeGreaterThan(state.edgeCount * 20);
  expect(state.verts % state.edgeCount).toBe(0);

  await win.screenshot({ path: path.join(OUT, '01-wireframed.png'), fullPage: false });

  // 4-angle showcase — the wireframe lattice looks distinct from every
  // angle.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `02-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender wireframe: subdivided icosa -> ${state.edgeCount} edges -> ${state.verts} verts (one 6-seg cylinder per edge)`);

  await app.close();
});
