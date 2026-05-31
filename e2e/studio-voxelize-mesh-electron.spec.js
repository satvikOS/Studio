import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-voxelize-mesh');

test('Studio — Cinema 4D / MagicaVoxel voxelize mesh (slice 299)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioVoxelizeMesh === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'voxelize demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'sphere', pos: [0, 0, 0], scale: [4, 4, 4], color: '#bca' }],
      expect: { bodies: 1, kinds: ['sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  const uuid = await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
    return m ? m.uuid : null;
  });
  expect(uuid).toBeTruthy();
  await win.waitForTimeout(400);

  // Voxelize at 16³.
  const res = await win.evaluate(({ u }) => {
    const r = window.__studioVoxelizeMesh({ meshUuid: u, resolution: 16 });
    // grid is Uint8Array — strip it from the payload so Playwright can serialize.
    return { ok: r.ok, resolution: r.resolution, voxelCount: r.voxelCount, bbox: r.bbox };
  }, { u: uuid });

  expect(res.ok).toBe(true);
  expect(res.resolution).toBe(16);
  expect(res.voxelCount).toBeGreaterThan(0);
  // A sphere at scale 4 fills a noticeable chunk of the 16³ grid.
  expect(res.voxelCount).toBeLessThan(16 * 16 * 16);
  expect(res.bbox.max[0]).toBeGreaterThan(res.bbox.min[0]);
  expect(res.bbox.max[1]).toBeGreaterThan(res.bbox.min[1]);
  expect(res.bbox.max[2]).toBeGreaterThan(res.bbox.min[2]);

  // Verify the userData stamp landed on the source mesh.
  const stamp = await win.evaluate(({ u }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) m = o; });
    return m && m.userData.archdiscStudioVoxelized;
  }, { u: uuid });
  expect(stamp.resolution).toBe(16);
  expect(stamp.voxelCount).toBe(res.voxelCount);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 299: voxelize at 16³ produced', res.voxelCount, 'occupied voxels');

  await app.close();
});
