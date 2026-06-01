import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-cursorops');

test('Studio V3 — Blender 3D Cursor family (slice 419)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetCursor === 'function', null, { timeout: 15000 });

  // Initial cursor at origin.
  let p = await win.evaluate(() => window.__studioGetCursor());
  expect(p).toEqual([0, 0, 0]);

  // Set + read.
  let r = await win.evaluate(() => window.__studioSetCursor([0.05, 0.02, -0.03]));
  expect(r.ok).toBe(true);
  expect(r.position).toEqual([0.05, 0.02, -0.03]);
  p = await win.evaluate(() => window.__studioCursorWorld());
  expect(p[0]).toBeCloseTo(0.05, 5);
  expect(p[1]).toBeCloseTo(0.02, 5);
  expect(p[2]).toBeCloseTo(-0.03, 5);

  // Snap to origin.
  r = await win.evaluate(() => window.__studioSnapCursorOrigin());
  expect(r.position).toEqual([0, 0, 0]);

  // Spawn + select cube, snap cursor to it.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const cubePos = await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
    return m ? [m.position.x, m.position.y, m.position.z] : null;
  });
  expect(cubePos).toBeTruthy();
  r = await win.evaluate(() => window.__studioSnapCursorSelection());
  expect(r.ok).toBe(true);
  expect(r.position[0]).toBeCloseTo(cubePos[0], 5);
  expect(r.position[1]).toBeCloseTo(cubePos[1], 5);
  expect(r.position[2]).toBeCloseTo(cubePos[2], 5);

  // 3D cursor lives in scene as a Group with archdisc3DCursor flag.
  const present = await win.evaluate(() => {
    let n = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdisc3DCursor) n++; });
    return n;
  });
  expect(present).toBe(1);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 419: 3D cursor set/get/snap-origin/snap-selection all ok');

  await app.close();
});
