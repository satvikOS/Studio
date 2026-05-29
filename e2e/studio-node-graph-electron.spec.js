import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — GEOMETRY NODE GRAPH editor (headed Electron).
 *
 * The #1 cross-cutting unlock: a Houdini SOP / Blender Geometry Nodes /
 * Grasshopper-style DAG that evaluates to live geometry, with a visual editor.
 * Verifies the editor opens, has a node palette + seed graph, can add a node,
 * and "Evaluate -> Scene" drops the evaluated geometry in as a primitive; plus
 * the engine via the hook, including a BRANCHING (multi-input merge) graph.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-node-graph');

test('Studio — geometry node graph evaluates a DAG to scene geometry', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioEvalNodeGraph === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  const countKind = (kind) => win.evaluate((k) => { let n = 0; const s = window.__archdiscScene; s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) n++; }); return n; }, kind);

  // ── 1) Open the editor via the ribbon; seed graph + palette present ──
  await win.locator('[data-studio-ribbon-action="node-editor"]').click();
  await expect(win.locator('[data-studio-nodegraph="editor"]')).toBeVisible({ timeout: 10000 });
  const seedNodes = await win.locator('[data-studio-nodegraph-node]').count();
  expect(seedNodes, 'seed graph has nodes (primitive->subdivide->bevel->output)').toBeGreaterThanOrEqual(4);
  // palette can add node types
  await expect(win.locator('[data-studio-nodegraph-add="displace"]')).toBeVisible();
  await win.locator('[data-studio-nodegraph-add="displace"]').click();
  await win.waitForTimeout(150);
  expect(await win.locator('[data-studio-nodegraph-node]').count(), 'adding a node from the palette').toBe(seedNodes + 1);
  await win.screenshot({ path: path.join(OUT, '01-node-editor.png') });

  // ── 2) Evaluate the seed graph -> a node-graph primitive enters the scene ──
  const before = await countKind('node-graph');
  await win.locator('[data-studio-nodegraph-action="evaluate"]').click();
  await win.waitForTimeout(400);
  expect(await countKind('node-graph'), 'Evaluate dropped a node-graph mesh into the scene').toBe(before + 1);
  // the evaluated seed (cube->subdivide->bevel) is rounded + tessellated (>8 verts)
  const seedVerts = await win.evaluate(() => { let m = null; const s = window.__archdiscScene; s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'node-graph') m = o; }); return m ? m.geometry.attributes.position.count : 0; });
  expect(seedVerts, 'evaluated geometry is tessellated by the graph').toBeGreaterThan(50);

  await win.locator('[data-studio-nodegraph-action="close"]').click();
  await expect(win.locator('[data-studio-nodegraph="editor"]')).toHaveCount(0);

  // ── 3) Engine via hook — a BRANCHING graph (two primitives -> merge) ──
  const branch = await win.evaluate(() => window.__studioEvalNodeGraph({
    nodes: [
      { id: 'p1', type: 'primitive', params: { kind: 'cube', size: 1 } },
      { id: 'p2', type: 'primitive', params: { kind: 'sphere', size: 1 } },
      { id: 't2', type: 'transform', params: { tx: 3, sx: 1, sy: 1, sz: 1 } },
      { id: 'mg', type: 'merge', params: {} },
      { id: 'o', type: 'output', params: {} },
    ],
    edges: [
      { from: { node: 'p1', port: 'geometry' }, to: { node: 'mg', port: 'a' } },
      { from: { node: 'p2', port: 'geometry' }, to: { node: 't2', port: 'geometry' } },
      { from: { node: 't2', port: 'geometry' }, to: { node: 'mg', port: 'b' } },
      { from: { node: 'mg', port: 'geometry' }, to: { node: 'o', port: 'geometry' } },
    ],
  }));
  expect(branch && branch.vertices, 'branching merge graph produced geometry').toBeGreaterThan(60);
  expect(await countKind('node-graph'), 'branching graph added a second node-graph mesh').toBe(before + 2);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(30, 18, 1.2); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '02-evaluated-geometry.png') });

  // eslint-disable-next-line no-console
  console.log(`  node graph: seed eval ${seedVerts} verts; branching merge ${branch.vertices} verts; 2 node-graph meshes in scene`);

  await app.close();
});
