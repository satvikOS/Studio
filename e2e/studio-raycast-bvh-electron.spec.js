import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-raycast-bvh');

test('Studio — BVH-accelerated raycasting (slice 314)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioRaycastBVH === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Spawn a large sphere so the bounding sphere is well above floor.
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(400);
  const sphereUuid = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    if (m) {
      // Grid layout offsets new primitives; force to origin so a vertical ray hits.
      m.position.set(0, 0, 0);
      m.scale.set(4, 4, 4);
      m.updateMatrixWorld(true);
    }
    return m.uuid;
  });
  expect(sphereUuid).toBeTruthy();
  await win.waitForTimeout(200);

  // Hit case: shoot a ray straight down from above origin. Should hit the sphere top.
  const hit = await win.evaluate(() => window.__studioRaycastBVH({
    origin: [0, 5, 0], direction: [0, -1, 0],
  }));
  expect(hit.hit).toBe(true);
  expect(hit.meshUuid).toBe(sphereUuid);
  // y should land between the floor and the top of the sphere (≈ 5 - sphere.radius).
  expect(hit.point[1]).toBeLessThan(5);
  expect(hit.point[1]).toBeGreaterThan(-1);
  expect(hit.bvh).toBe(true);

  // Miss case: shoot upward, no hit.
  const miss = await win.evaluate(() => window.__studioRaycastBVH({
    origin: [0, 5, 0], direction: [0, 1, 0],
  }));
  expect(miss.hit).toBe(false);

  // Far-clip case: short ray can't reach.
  const farMiss = await win.evaluate(() => window.__studioRaycastBVH({
    origin: [0, 5, 0], direction: [0, -1, 0], far: 0.5,
  }));
  expect(farMiss.hit).toBe(false);

  // Filter case: exclude the only mesh in scene → no hit.
  const filtered = await win.evaluate(({ u }) => window.__studioRaycastBVH({
    origin: [0, 5, 0], direction: [0, -1, 0], filterUuid: u,
  }), { u: sphereUuid });
  expect(filtered.hit).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 314: BVH raycast hit at y=', hit.point[1].toFixed(3), 'distance=', hit.distance.toFixed(3));

  await app.close();
});
