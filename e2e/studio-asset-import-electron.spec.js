import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — ASSET IMPORT PIPELINE (headed Electron).
 *
 * Closes a real parity gap: before this, the only "import" was a placeholder
 * that spawned a tetrahedron. Now Studio has a real three.js GLTFLoader /
 * OBJLoader pipeline (Maya / 3ds Max / Blender / Unreal / Unity interop).
 * Imported meshes become first-class Studio primitives (selectable,
 * transformable, re-exportable).
 *
 * Proven two ways:
 *   1. glTF EXPORT -> IMPORT round-trip (interop both directions, real geom).
 *   2. A hand-written OBJ pyramid imported from text.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-asset-import');

// Minimal valid OBJ: a 4-face pyramid (square base + apex).
const OBJ_PYRAMID = `# studio test pyramid
v -1 0 -1
v  1 0 -1
v  1 0  1
v -1 0  1
v  0 1.6 0
f 1 2 5
f 2 3 5
f 3 4 5
f 4 1 5
f 4 3 2
f 4 2 1
`;

test('Studio — real glTF round-trip + OBJ import integrate as primitives', async () => {
  test.setTimeout(300000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioImportAsset === 'function', null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioExportGltfString === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  const countBodies = () => win.evaluate(() => {
    let n = 0, imported = 0;
    const s = window.__archdiscScene;
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) { n++; if (o.userData.archdiscStudioPrimitiveKind === 'imported') imported++; } });
    return { n, imported };
  });

  // ── 1) glTF round-trip: build a known model, export to glTF string, clear,
  //       re-import it. The re-imported bodies must come back as primitives. ──
  const exported = await win.evaluate(async () => {
    await window.__archieRun({ goals: ['lantern post'], maxGoals: 1 }); // 3-body model
    const str = await window.__studioExportGltfString();
    return { len: str ? str.length : 0, str };
  });
  expect(exported.len, 'exported a non-trivial glTF string').toBeGreaterThan(500);

  // Re-import the exported glTF (adds the meshes back as imported primitives).
  const gltfRes = await win.evaluate(async (gltf) => window.__studioImportAsset('gltf', gltf), exported.str);
  expect(gltfRes.added, 'glTF import added meshes').toBeGreaterThanOrEqual(1);

  const afterGltf = await countBodies();
  expect(afterGltf.imported, 'imported glTF meshes are tagged + registered').toBeGreaterThanOrEqual(1);
  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(32, 16, 1.15); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-gltf-roundtrip.png') });

  // ── 2) OBJ import from text — imported pyramid registers + is selectable ──
  const objRes = await win.evaluate((objText) => window.__studioImportAsset('obj', objText), OBJ_PYRAMID);
  expect(objRes.added, 'OBJ import added the pyramid mesh').toBeGreaterThanOrEqual(1);

  const afterObj = await countBodies();
  expect(afterObj.imported, 'OBJ pyramid is an imported primitive').toBeGreaterThan(afterGltf.imported);

  // the imported mesh is a real selectable Studio primitive
  const selectable = await win.evaluate(() => {
    const s = window.__archdiscScene; let target = null;
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'imported') target = o; });
    if (!target || !window.__studioSelectMesh) return false;
    window.__studioSelectMesh(target);
    return !!(window.__studioSelectedMesh && window.__studioSelectedMesh() === target);
  });
  expect(selectable, 'an imported mesh can be selected like any primitive').toBe(true);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(40, 18, 1.15); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '02-obj-import.png') });

  // eslint-disable-next-line no-console
  console.log(`  import: glTF added ${gltfRes.added}, OBJ added ${objRes.added}, imported-primitives total ${afterObj.imported}`);

  await app.close();
});
