import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-uv-pack');

test('Studio V3 — UV pack: planar/cube/sphere/cylinder/scale/rotate (slice 630)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // 1: planar
  const planar = await win.evaluate(() => window.__studioUvProjectPlanar('y'));
  expect(planar.ok).toBe(true);
  expect(planar.axis).toBe('y');
  await win.screenshot({ path: path.join(OUT, '01-planar.png') });

  // 2: cube
  const cube = await win.evaluate(() => window.__studioUvProjectCube());
  expect(cube.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '02-cube.png') });

  // 3: sphere
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const sph = await win.evaluate(() => window.__studioUvProjectSphere());
  expect(sph.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-sphere.png') });

  // 4: cylinder
  await win.locator('[data-studio-v3-tool="cylinder"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const cyl = await win.evaluate(() => window.__studioUvProjectCylinder());
  expect(cyl.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '04-cyl.png') });

  // 5: scale
  const scale = await win.evaluate(() => window.__studioUvScale(2));
  expect(scale.ok).toBe(true);
  expect(scale.scale).toBe(2);
  await win.screenshot({ path: path.join(OUT, '05-scale.png') });

  // 6: rotate
  const before = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return [m.geometry.attributes.uv.array[0], m.geometry.attributes.uv.array[1]];
  });
  const rot = await win.evaluate(() => window.__studioUvRotate(90));
  expect(rot.ok).toBe(true);
  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return [m.geometry.attributes.uv.array[0], m.geometry.attributes.uv.array[1]];
  });
  expect(before[0] !== after[0] || before[1] !== after[1]).toBe(true);
  await win.screenshot({ path: path.join(OUT, '06-rotate.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 630: 6 features — planar/cube/sphere/cyl projection + scale/rotate');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
