import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-camera-registry');

test('Studio V3 — camera registry: create/list/setPos/setTarget/snap/delete (slice 638)', async () => {
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

  // 1: create two cameras
  const c1 = await win.evaluate(() => window.__studioCameraCreate('hero', { position: [3, 2, 3], target: [0, 0, 0], fov: 35 }));
  expect(c1.ok).toBe(true);
  const c2 = await win.evaluate(() => window.__studioCameraCreate('topdown', { position: [0, 5, 0], target: [0, 0, 0], fov: 60 }));
  expect(c2.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-create.png') });

  // 2: list
  const list = await win.evaluate(() => window.__studioCameraListAll());
  expect(list.count).toBe(2);
  expect(list.cameras[0].fov).toBe(35);
  expect(list.cameras[1].position[1]).toBe(5);
  await win.screenshot({ path: path.join(OUT, '02-list.png') });

  // 3: setPosition
  const sp = await win.evaluate((u) => window.__studioCameraSetPosition(u, [1, 1, 5]), c1.uuid);
  expect(sp.ok).toBe(true);
  const posCheck = await win.evaluate((u) => {
    const cams = window.__studioCameras;
    const rec = cams.find((r) => r.uuid === u);
    return [rec.camera.position.x, rec.camera.position.y, rec.camera.position.z];
  }, c1.uuid);
  expect(posCheck).toEqual([1, 1, 5]);
  await win.screenshot({ path: path.join(OUT, '03-setPos.png') });

  // 4: setTarget
  const st = await win.evaluate((u) => window.__studioCameraSetTarget(u, [0, 1, 0]), c1.uuid);
  expect(st.ok).toBe(true);
  expect(st.target).toEqual([0, 1, 0]);
  await win.screenshot({ path: path.join(OUT, '04-setTarget.png') });

  // 5: snap main camera
  const mainBefore = await win.evaluate(() => [
    window.__archdiscViewport.camera.position.x,
    window.__archdiscViewport.camera.position.y,
    window.__archdiscViewport.camera.position.z,
  ]);
  const snap = await win.evaluate((u) => window.__studioCameraSnapMainTo(u), c2.uuid);
  expect(snap.ok).toBe(true);
  expect(snap.snapped).toBe('topdown');
  const mainAfter = await win.evaluate(() => [
    window.__archdiscViewport.camera.position.x,
    window.__archdiscViewport.camera.position.y,
    window.__archdiscViewport.camera.position.z,
  ]);
  expect(mainAfter).not.toEqual(mainBefore);
  expect(mainAfter[1]).toBe(5);
  await win.screenshot({ path: path.join(OUT, '05-snap.png') });

  // 6: delete
  const del = await win.evaluate((u) => window.__studioCameraDelete(u), c1.uuid);
  expect(del.ok).toBe(true);
  expect(del.remaining).toBe(1);
  const after = await win.evaluate(() => window.__studioCameraListAll());
  expect(after.count).toBe(1);
  expect(after.cameras[0].name).toBe('topdown');
  await win.screenshot({ path: path.join(OUT, '06-delete.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 638: 6 camera-registry features verified');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
