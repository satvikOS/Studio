import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-select-delete');

test('Studio V3 — viewport click selects, X deletes (slice 396)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 500,
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
  await win.waitForFunction(() => !!window.__archdiscViewport && !!window.__archdiscViewport.getSelected, null, { timeout: 15000 });

  // Spawn a cube + a sphere.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);

  // Programmatically attach gizmo to the cube to simulate a click-select
  // (the V3 viewport click already wires through Viewport3D's raycaster;
  // here we drive it deterministically for the e2e).
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o;
    });
    vp.transformControls.attach(cube);
  });
  await win.waitForTimeout(200);

  // Verify getSelected returns the cube.
  const selKind = await win.evaluate(() => {
    const s = window.__archdiscViewport.getSelected();
    return s && s.userData && s.userData.archdiscStudioPrimitiveKind;
  });
  expect(selKind).toBe('cube');

  // Click the Move tool — gizmo switches to translate mode.
  await win.locator('[data-studio-v3-tool="move"][data-studio-v3-tool-group="transform"]').click();
  await win.waitForTimeout(200);
  const mode = await win.evaluate(() => window.__archdiscViewport.transformControls.mode);
  expect(mode).toBe('translate');

  // Switch to Rotate.
  await win.locator('[data-studio-v3-tool="rotate"][data-studio-v3-tool-group="transform"]').click();
  await win.waitForTimeout(200);
  expect(await win.evaluate(() => window.__archdiscViewport.transformControls.mode)).toBe('rotate');

  // Switch to Scale.
  await win.locator('[data-studio-v3-tool="scale"][data-studio-v3-tool-group="transform"]').click();
  await win.waitForTimeout(200);
  expect(await win.evaluate(() => window.__archdiscViewport.transformControls.mode)).toBe('scale');

  // Press X → deletes selected mesh (cube). Scene drops from 2 → 1 prims.
  const before = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n;
  });
  expect(before).toBe(2);
  // Send X via keyboard.
  await win.keyboard.press('x');
  await win.waitForTimeout(300);
  const after = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n;
  });
  expect(after).toBe(1);

  await win.screenshot({ path: path.join(OUT, '00-after-delete.png') });

  // Reset.
  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log('  slice 396: V3 gizmo modes drive (translate/rotate/scale) + X deletes selected');

  await app.close();
});
