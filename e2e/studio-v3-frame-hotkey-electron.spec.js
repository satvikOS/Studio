import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-frame-hotkey');

test('Studio V3 — . frames selected mesh (slice 435)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioFitSelected === 'function', null, { timeout: 15000 });

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Spawn + select cube at a known offset.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m) {
      m.position.set(0.2, 0.1, -0.1);
      m.updateMatrixWorld(true);
      if (window.__studioSelectMesh) window.__studioSelectMesh(m);
    }
  });

  // Move camera far away then press '.'
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    vp.camera.position.set(5, 5, 5);
    if (vp.orbitControls) vp.orbitControls.update();
  });
  const before = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    return [vp.camera.position.x, vp.camera.position.y, vp.camera.position.z];
  });
  expect(Math.hypot(before[0], before[1], before[2])).toBeGreaterThan(3);

  await win.keyboard.press('.');
  await win.waitForTimeout(300);

  // After: camera should now be much closer (frame-selected typically
  // pulls camera to ~10x the bbox diagonal which is much less than 5).
  const after = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    return [vp.camera.position.x, vp.camera.position.y, vp.camera.position.z];
  });
  const dist = Math.hypot(after[0], after[1], after[2]);
  expect(dist).toBeLessThan(2);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 435: . moves cam from', before.map((x) => x.toFixed(2)), '→', after.map((x) => x.toFixed(2)));

  await app.close();
});
