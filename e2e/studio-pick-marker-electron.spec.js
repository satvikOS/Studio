import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-pick-marker');

test('Studio — edit-mode pick renders viewport marker (slice 378)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 600,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => typeof window.__studioRenderPickMarker === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // Helper: count marker objects in scene.
  const markerCount = () => win.evaluate(() => {
    let n = 0;
    if (!window.__archdiscScene) return 0;
    window.__archdiscScene.traverse((o) => { if (o.name === '__studio_pick_marker__') n++; });
    return n;
  });

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0, 0, 0); m.scale.set(1, 1, 1); m.updateMatrixWorld(true);
    const vp = window.__archdiscViewport;
    vp.camera.position.set(0, 0, 0.08);
    if (vp.orbitControls) { vp.orbitControls.target.set(0, 0, 0); vp.orbitControls.update(); }
    vp.camera.updateMatrixWorld(true);
  });
  await win.waitForTimeout(200);

  // Vertex pick → 1 marker.
  await win.evaluate(() => {
    const r = window.__studioPickVertexFromClick(0, 0);
    window.dispatchEvent(new CustomEvent('studio-pick', { detail: { mode: 'vertex', result: r } }));
  });
  await win.waitForTimeout(150);
  expect(await markerCount()).toBe(1);

  // Edge pick → still 1 (replaces, not stacks).
  await win.evaluate(() => {
    const r = window.__studioPickEdgeFromClick(0, 0);
    window.dispatchEvent(new CustomEvent('studio-pick', { detail: { mode: 'edge', result: r } }));
  });
  await win.waitForTimeout(150);
  expect(await markerCount()).toBe(1);

  // Face pick → still 1.
  await win.evaluate(() => {
    const r = window.__studioPickFaceFromClick(0, 0);
    window.dispatchEvent(new CustomEvent('studio-pick', { detail: { mode: 'face', result: r } }));
  });
  await win.waitForTimeout(150);
  expect(await markerCount()).toBe(1);

  // Switch back to object mode → markers cleared.
  await win.evaluate(() => window.__studioSetEditMode('object'));
  await win.waitForTimeout(150);
  expect(await markerCount()).toBe(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 378: vert/edge/face markers render + replace + clear on object mode');

  await app.close();
});
