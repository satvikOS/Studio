import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-march-voxel-grid');

test('Studio — Cinema 4D Volume Mesher (marching cubes from voxel grid) (slice 306)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 700,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioMarchVoxelGrid === 'function', null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioVoxelizeMesh === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Spawn a sphere via ribbon for a known source, scale up, then voxelize.
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(400);
  await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    if (m) { m.scale.set(4, 4, 4); if (window.__studioSelectMesh) window.__studioSelectMesh(m); }
  });
  await win.waitForTimeout(300);

  // Voxelize (returns grid + bbox).
  const vox = await win.evaluate(() => {
    const r = window.__studioVoxelizeMesh({ resolution: 16 });
    if (!r || !r.ok) return null;
    // Pass grid back via window to avoid serializing Uint8Array.
    window.__testVoxRes = r;
    return { resolution: r.resolution, voxelCount: r.voxelCount, bbox: r.bbox };
  });
  expect(vox).toBeTruthy();
  expect(vox.voxelCount).toBeGreaterThan(0);

  // Run marching cubes on it.
  const march = await win.evaluate(() => {
    const r = window.__testVoxRes;
    return window.__studioMarchVoxelGrid({ grid: r.grid, resolution: r.resolution, bbox: r.bbox });
  });
  expect(march).toBeTruthy();
  expect(march.ok).toBe(true);
  expect(march.resolution).toBe(16);
  expect(march.vertices).toBeGreaterThan(0);

  const probe = await win.evaluate(({ u }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) m = o; });
    return m ? {
      isMesh: m.isMesh === true,
      vertCount: m.geometry.attributes.position.count,
      kind: m.userData.archdiscStudioPrimitiveKind,
      stamp: m.userData.archdiscStudioVoxelMarched,
    } : null;
  }, { u: march.uuid });
  expect(probe).toBeTruthy();
  expect(probe.isMesh).toBe(true);
  expect(probe.kind).toBe('voxel-march');
  expect(probe.stamp.resolution).toBe(16);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 306: marching cubes produced', march.vertices, 'verts from', vox.voxelCount, 'voxels');

  await app.close();
});
