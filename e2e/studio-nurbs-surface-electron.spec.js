import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — NURBS SURFACE (Maya / Rhino / Plasticity) (headed Electron).
 *
 * Closes a DCC gap (real NURBS surfaces — previously ABSENT in Studio; the
 * B-rep kernel existed but was unwired). A rational degree-3 tensor-product
 * NURBS surface (three's Cox-de Boor evaluator) tessellated into a Studio
 * primitive, and available as a node-graph source node (Grasshopper-style).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-nurbs-surface');

test('Studio — rational NURBS surface as a primitive + a node-graph node', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 25 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioEvalNodeGraph === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // ── 1) NURBS surface as a ribbon primitive ──
  await win.locator('[data-studio-primitive="nurbs-surface"]').click();
  await win.waitForTimeout(300);
  const surf = await win.evaluate(() => {
    let m = null; const s = window.__archdiscScene;
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'nurbs-surface') m = o; });
    if (!m) return null;
    m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox;
    return { verts: m.geometry.attributes.position.count, nurbs: m.userData.archdiscNurbs, yExtent: b.max.y - b.min.y };
  });
  expect(surf, 'NURBS surface primitive created').not.toBeNull();
  expect(surf.nurbs && surf.nurbs.degree, 'degree-3 NURBS').toBe(3);
  expect(surf.nurbs.rational, 'rational (weighted control points)').toBe(true);
  expect(surf.verts, 'tessellated surface').toBeGreaterThan(500);
  expect(surf.yExtent, 'surface is curved (not a flat plane)').toBeGreaterThan(0.001);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(34, 28, 1.15); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-nurbs-surface.png') });

  // ── 2) NURBS as a geometry-node-graph source node (Grasshopper-style) ──
  const node = await win.evaluate(() => window.__studioEvalNodeGraph({
    nodes: [
      { id: 'n', type: 'nurbs', params: { amplitude: 2.2, centerWeight: 2.5 } },
      { id: 'o', type: 'output', params: {} },
    ],
    edges: [{ from: { node: 'n', port: 'geometry' }, to: { node: 'o', port: 'geometry' } }],
  }));
  expect(node && node.vertices, 'NURBS node evaluated geometry in the graph').toBeGreaterThan(500);

  // eslint-disable-next-line no-console
  console.log(`  nurbs: primitive ${surf.verts} verts (degree ${surf.nurbs.degree}, ${surf.nurbs.nu}x${surf.nurbs.nv} CPs, rational=${surf.nurbs.rational}), y-extent ${surf.yExtent.toFixed(4)}; node-graph nurbs ${node.vertices} verts`);

  await app.close();
});
