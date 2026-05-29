import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 44 — glTF Export.
 *
 * One click exports the current Studio primitives + lights as a
 * spec-compliant glTF (ASCII, embedded). Mech's inherited viewport
 * helpers (axes, ground plane, gizmos, default lights) are filtered
 * out by cloning Studio-tagged objects into a fresh scene before
 * passing to GLTFExporter.
 *
 * Spec builds a small scene, exports, then verifies the produced
 * JSON has glTF 2.0 structure (asset { version: "2.0" }, scenes,
 * nodes, meshes, accessors, materials).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-gltf-export');

test('Studio glTF export — Studio scene round-trips through GLTFExporter', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 2200,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Build: 3 primitives (cube, sphere, suzanne) + 2 lights via 3-point lighting.
  for (const k of ['cube', 'sphere', 'suzanne']) {
    await win.locator(`[data-studio-primitive="${k}"]`).click();
    await win.waitForTimeout(220);
  }
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rendering"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-action="three-point-preset"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-light-count]')).toHaveText('3 added');

  // ---- Baseline: no export yet ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="modeling"]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-export-status]')).toHaveText('No export yet');

  // ---- Export ----
  await win.locator('[data-studio-action="export-gltf"]').click();
  // Exporter is async — poll the status line.
  await expect.poll(
    async () => await win.locator('[data-studio-export-status]').textContent(),
    { timeout: 10000 },
  ).toContain('Exported');

  // Pull the cached JSON from the window stash and verify structure.
  const gltf = await win.evaluate(() => {
    try { return JSON.parse(window.__studioLastGltf || ''); } catch (e) { return null; }
  });
  expect(gltf).not.toBeNull();
  expect(gltf.asset).toBeDefined();
  expect(gltf.asset.version).toBe('2.0');
  expect(Array.isArray(gltf.scenes)).toBe(true);
  expect(Array.isArray(gltf.nodes)).toBe(true);
  expect(gltf.nodes.length).toBeGreaterThanOrEqual(3); // 3 primitives + lights
  expect(Array.isArray(gltf.meshes)).toBe(true);
  expect(gltf.meshes.length).toBeGreaterThanOrEqual(3);
  expect(Array.isArray(gltf.accessors)).toBe(true);
  expect(gltf.accessors.length).toBeGreaterThan(0);
  // Materials section may exist; some glTF setups include it.
  if (gltf.materials) expect(Array.isArray(gltf.materials)).toBe(true);

  // Persist a sample to the spec's output dir so a human reviewer can
  // open it in three.js sandbox / Sketchfab if they want.
  const json = await win.evaluate(() => window.__studioLastGltf);
  fs.writeFileSync(path.join(OUT, 'studio-scene.gltf'), json);

  await win.screenshot({ path: path.join(OUT, 'panel-after-export.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  gltf export: ${gltf.nodes.length} nodes, ${gltf.meshes.length} meshes, ${gltf.accessors.length} accessors, ${(json.length / 1024).toFixed(1)} KiB`);

  await app.close();
});
