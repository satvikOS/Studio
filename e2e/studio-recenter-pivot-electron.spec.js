import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-recenter-pivot');

test('Studio — Recenter pivot to geometry (slice 332)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioRecenterPivot === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Spawn cube. Cube vertices range [-0.0075, +0.0075] (half-edge). Centroid is at origin.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);

  // Shift every vertex by (+0.2, 0, 0) — moves the cloud away from local origin.
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + 0.2);
    p.needsUpdate = true;
    m.geometry.computeBoundingSphere();
  });
  await win.waitForTimeout(150);

  // Capture v0 + mesh.position before recenter.
  const before = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    return {
      v0World: [p.getX(0) + m.position.x, p.getY(0) + m.position.y, p.getZ(0) + m.position.z],
      meshPos: [m.position.x, m.position.y, m.position.z],
    };
  });

  // Recenter — origin should move to centroid (+0.2, 0, 0); vertices shift to recover.
  const r = await win.evaluate(() => window.__studioRecenterPivot({ mode: 'centroid' }));
  expect(r.ok).toBe(true);
  expect(r.offset[0]).toBeCloseTo(0.2, 4);

  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    return {
      v0World: [p.getX(0) + m.position.x, p.getY(0) + m.position.y, p.getZ(0) + m.position.z],
      meshPos: [m.position.x, m.position.y, m.position.z],
      stamp: m.userData.archdiscStudioRecenteredPivot,
    };
  });
  // Visual position of vertex 0 in world should be unchanged.
  expect(after.v0World[0]).toBeCloseTo(before.v0World[0], 4);
  expect(after.v0World[1]).toBeCloseTo(before.v0World[1], 4);
  expect(after.v0World[2]).toBeCloseTo(before.v0World[2], 4);
  // Mesh position shifted by +0.2 on X.
  expect(after.meshPos[0] - before.meshPos[0]).toBeCloseTo(0.2, 4);
  expect(after.stamp).toBe(1);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 332: recenter pivot — offset', r.offset, 'mesh.x shifted to', after.meshPos[0].toFixed(4));

  await app.close();
});
