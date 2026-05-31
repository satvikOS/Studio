import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-edit-mode-click');

test('Studio — click in edit mode dispatches picker (slice 377)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetEditMode === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // Spawn cube, frame to viewport centre.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0, 0, 0); m.scale.set(1, 1, 1); m.updateMatrixWorld(true);
    const vp = window.__archdiscViewport;
    vp.camera.position.set(0, 0, 0.08);
    if (vp.orbitControls) {
      vp.orbitControls.target.set(0, 0, 0);
      vp.orbitControls.update();
    } else {
      vp.camera.lookAt(0, 0, 0);
    }
    vp.camera.updateMatrixWorld(true);
  });
  await win.waitForTimeout(200);

  // Find canvas centre in client px.
  const box = await win.locator('canvas').first().boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Helper: arm a one-shot 'studio-pick' listener that resolves on dispatch.
  const armPickListener = () => win.evaluate(() => {
    window.__lastStudioPick = null;
    const h = (ev) => { window.__lastStudioPick = ev.detail; window.removeEventListener('studio-pick', h); };
    window.addEventListener('studio-pick', h);
  });

  // VERTEX mode → click → vertex picker fires.
  await win.evaluate(() => window.__studioSetEditMode('vertex'));
  await armPickListener();
  await win.mouse.move(cx, cy);
  await win.mouse.down(); await win.mouse.up();
  await win.waitForFunction(() => !!window.__lastStudioPick, null, { timeout: 5000 });
  const vPick = await win.evaluate(() => window.__lastStudioPick);
  expect(vPick.mode).toBe('vertex');
  expect(vPick.result.ok).toBe(true);
  expect(vPick.result.vertIdx).toBeGreaterThanOrEqual(0);

  // FACE mode → click → face picker fires.
  await win.evaluate(() => window.__studioSetEditMode('face'));
  await armPickListener();
  await win.mouse.move(cx, cy);
  await win.mouse.down(); await win.mouse.up();
  await win.waitForFunction(() => !!window.__lastStudioPick, null, { timeout: 5000 });
  const fPick = await win.evaluate(() => window.__lastStudioPick);
  expect(fPick.mode).toBe('face');
  expect(fPick.result.ok).toBe(true);
  expect(fPick.result.vertIdx.length).toBe(3);

  // EDGE mode → click → edge picker fires.
  await win.evaluate(() => window.__studioSetEditMode('edge'));
  await armPickListener();
  await win.mouse.move(cx, cy);
  await win.mouse.down(); await win.mouse.up();
  await win.waitForFunction(() => !!window.__lastStudioPick, null, { timeout: 5000 });
  const ePick = await win.evaluate(() => window.__lastStudioPick);
  expect(ePick.mode).toBe('edge');
  expect(ePick.result.ok).toBe(true);
  expect(ePick.result.vertIdx.length).toBe(2);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // Reset to object mode so we don't pollute subsequent tests.
  await win.evaluate(() => window.__studioSetEditMode('object'));

  // eslint-disable-next-line no-console
  console.log('  slice 377: vertex/face/edge click dispatch all fired');

  await app.close();
});
