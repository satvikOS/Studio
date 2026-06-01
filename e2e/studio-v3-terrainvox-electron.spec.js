import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-terrainvox');

test('Studio V3 — terrain + voxel + volume family (slice 412)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioAddMountain === 'function', null, { timeout: 15000 });

  // Mountain.
  let r = await win.evaluate(() => window.__studioAddMountain({ radius: 0.04, segments: 16, strength: 0.4, seed: 7 }));
  expect(r.ok).toBe(true);
  expect(r.verts).toBeGreaterThan(0);

  // Terrain.
  r = await win.evaluate(() => window.__studioTerrainAdd({ width: 4, depth: 4, segments: 16 }));
  expect(r.ok).toBe(true);

  // Sculpt.
  r = await win.evaluate(() => window.__studioTerrainSculpt({ worldX: 0, worldZ: 0, mode: 'raise', radius: 1, strength: 0.5 }));
  expect(r.ok).toBe(true);
  expect(r.touched).toBeGreaterThan(0);

  // Volume.
  r = await win.evaluate(() => window.__studioAddVolume({ size: 0.1, density: 0.5, color: 0xc0c0c0, steps: 16 }));
  expect(r.ok).toBe(true);

  // VoxelizeMesh → grid back, MarchVoxelGrid → new mesh.
  await win.evaluate(() => {
    // Use the mountain mesh (it's a real primitive).
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    let mnt = null;
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'mountain') mnt = o; });
    if (window.__studioSelectMesh && mnt) window.__studioSelectMesh(mnt);
  });
  const vox = await win.evaluate(() => window.__studioVoxelizeMesh({ resolution: 12 }));
  expect(vox.ok).toBe(true);
  expect(vox.voxelCount).toBeGreaterThan(0);

  const march = await win.evaluate((v) => window.__studioMarchVoxelGrid({ grid: v.grid, resolution: v.resolution, bbox: v.bbox }), vox);
  expect(march.ok).toBe(true);
  expect(march.vertices).toBeGreaterThan(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 412: mountain + terrain + sculpt + volume + voxelize + march all ok');

  await app.close();
});
