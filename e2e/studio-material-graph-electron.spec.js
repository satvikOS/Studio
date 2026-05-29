import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — MATERIAL / SHADER NODE GRAPH (headed Electron).
 *
 * Closes the node-based material editor gap (Substance Designer / Unreal
 * Material Editor / Unity Shader Graph / Blender shader nodes). The same DAG
 * engine that drives geometry nodes is retargeted: procedural Texture / Color /
 * Scalar nodes feed a Material Output node that assembles a PBR
 * MeshStandardMaterial, applied to the selected mesh.
 *
 * Verifies: the editor opens with a material palette + seed graph; Evaluate
 * applies a real CanvasTexture map (a NON-uniform procedural pattern, not a flat
 * fill) + the seed roughness onto the selected sphere; and the engine via hook
 * drives the PBR channels (color / metalness / emissive / checker map) exactly.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-material-graph');

test('Studio — material graph assembles a PBR material from a shading DAG', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioApplyMaterialGraph === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // ── a sphere (clean UVs for the texture map), selected ──
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(250);
  await win.evaluate(() => { const s = window.__archdiscScene; let m = null; s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) m = o; }); if (m) window.__studioSelectMesh(m); });
  await win.waitForTimeout(200);

  // ── 1) Open the Material Graph editor via the ribbon ──
  await win.locator('[data-studio-ribbon-action="material-editor"]').click();
  await expect(win.locator('[data-studio-nodegraph="material"]')).toBeVisible({ timeout: 10000 });
  // seed graph: texture -> output (map), scalar -> output (roughness)
  const seedNodes = await win.locator('[data-studio-nodegraph-node]').count();
  expect(seedNodes, 'material seed graph has nodes (texture/scalar/output)').toBeGreaterThanOrEqual(3);
  await expect(win.locator('[data-studio-nodegraph-node="texture"]')).toBeVisible();
  await expect(win.locator('[data-studio-nodegraph-node="output"]')).toBeVisible();
  // material palette (distinct from geometry nodes) — colorMix is material-only
  await expect(win.locator('[data-studio-nodegraph-add="colorMix"]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '01-material-editor.png') });

  // ── 2) Evaluate the seed graph -> PBR material on the selected sphere ──
  await win.locator('[data-studio-nodegraph-action="evaluate"]').click();
  await win.waitForTimeout(400);
  const applied = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    if (!m || !m.material) return null;
    const mat = m.material;
    let texDiff = null, sampA = null, sampB = null;
    if (mat.map && mat.map.image && mat.map.image.getContext) {
      const ctx = mat.map.image.getContext('2d');
      sampA = Array.from(ctx.getImageData(8, 8, 1, 1).data);
      sampB = Array.from(ctx.getImageData(200, 200, 1, 1).data);
      texDiff = Math.abs(sampA[0] - sampB[0]) + Math.abs(sampA[1] - sampB[1]) + Math.abs(sampA[2] - sampB[2]);
    }
    return { hasMap: !!mat.map, roughness: mat.roughness, metalness: mat.metalness, texDiff, sampA, sampB, graph: m.userData.archdiscStudioMaterialGraph };
  });
  expect(applied, 'material applied to the selected mesh').not.toBeNull();
  expect(applied.hasMap, 'seed graph put a CanvasTexture map on the material').toBe(true);
  // the procedural texture is a REAL pattern, not a flat fill -> two texels differ
  expect(applied.texDiff, 'procedural texture is non-uniform (a real pattern)').toBeGreaterThan(20);
  // the seed scalar (0.35) drove the roughness channel
  expect(Math.abs(applied.roughness - 0.35), 'seed scalar drove roughness=0.35').toBeLessThan(0.02);

  await win.locator('[data-studio-nodegraph-action="close"]').click();
  await expect(win.locator('[data-studio-nodegraph="material"]')).toHaveCount(0);

  // ── 3) Engine via hook — drive all PBR channels explicitly ──
  // base color #cc3333, metalness 0.9 (scalar), checker map, emissive #224488.
  const spec = await win.evaluate(() => window.__studioApplyMaterialGraph({
    nodes: [
      { id: 'col', type: 'color', params: { color: '#cc3333' } },
      { id: 'emi', type: 'color', params: { color: '#224488' } },
      { id: 'met', type: 'scalar', params: { value: 0.9 } },
      { id: 'tex', type: 'texture', params: { pattern: 'checker', scale: 8, colorA: '#101010', colorB: '#e0e0e0' } },
      { id: 'o', type: 'output', params: {} },
    ],
    edges: [
      { from: { node: 'col', port: 'col' }, to: { node: 'o', port: 'color' } },
      { from: { node: 'emi', port: 'col' }, to: { node: 'o', port: 'emissive' } },
      { from: { node: 'met', port: 'val' }, to: { node: 'o', port: 'metalness' } },
      { from: { node: 'tex', port: 'tex' }, to: { node: 'o', port: 'map' } },
    ],
  }));
  expect(spec.error, 'channel graph evaluated without error').toBeFalsy();
  expect(spec.hasMap, 'map channel wired').toBe(true);
  expect(spec.mapPattern, 'checker texture pattern flowed to the map channel').toBe('checker');
  expect(spec.colorHex.toLowerCase(), 'base color channel = #cc3333').toBe('#cc3333');
  expect(spec.emissiveHex.toLowerCase(), 'emissive channel = #224488').toBe('#224488');
  expect(Math.abs(spec.metalness - 0.9), 'metalness scalar channel = 0.9').toBeLessThan(0.02);

  // ── 4) render the textured sphere from a clean framing ──
  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(24, 12, 1.25); });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '02-pbr-material.png') });

  // eslint-disable-next-line no-console
  console.log(`  material graph: seed map texDiff=${applied.texDiff} (samples ${applied.sampA}/${applied.sampB}), roughness=${applied.roughness}; channel graph -> color ${spec.colorHex}, emissive ${spec.emissiveHex}, metal ${spec.metalness}, ${spec.mapPattern} map`);

  await app.close();
});
