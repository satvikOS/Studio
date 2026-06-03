import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-lookat');

test('Studio V3 — Look-at constraint rotates source toward target (slice 585)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
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
  await win.waitForTimeout(100);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(500);

  // Position the cube at origin, sphere off to +Z.
  const uuids = await win.evaluate(() => {
    let cube = null, sphere = null;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o;
      else if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') sphere = o;
    });
    cube.position.set(0, 0, 0); cube.rotation.set(0, 0, 0); cube.updateMatrixWorld(true);
    sphere.position.set(0, 0, 0.5); sphere.updateMatrixWorld(true);
    window.__studioSelectMesh(cube);
    return { cube: cube.uuid, sphere: sphere.uuid };
  });
  await win.waitForTimeout(200);

  await win.evaluate(([s, t]) => window.__studioSetLookAt(s, t), [uuids.cube, uuids.sphere]);
  await win.waitForTimeout(300); // rAF tick

  const rot = await win.evaluate((c) => {
    let cube = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === c) cube = o; });
    return [cube.rotation.x, cube.rotation.y, cube.rotation.z];
  }, uuids.cube);

  // lookAt(+Z) keeps rotation at identity (cube already faces +Z by default).
  // Move sphere to +X and verify rotation actually changes.
  await win.evaluate((s) => {
    let sphere = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === s) sphere = o; });
    sphere.position.set(0.5, 0, 0); sphere.updateMatrixWorld(true);
  }, uuids.sphere);
  await win.waitForTimeout(300);

  const rot2 = await win.evaluate((c) => {
    let cube = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === c) cube = o; });
    return [cube.rotation.x, cube.rotation.y, cube.rotation.z];
  }, uuids.cube);

  // After moving target to +X, cube should rotate ~ -90° around Y.
  expect(Math.abs(rot2[1])).toBeGreaterThan(0.5);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 585: look-at rot1', rot.map((n)=>n.toFixed(2)).join(','), '→', rot2.map((n)=>n.toFixed(2)).join(','));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
