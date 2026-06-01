import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-markers');

test('Studio V3 — edit-mode marker renderers (slice 422)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioRenderPickMarker === 'function', null, { timeout: 15000 });

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });

  // Helper: count marker objects.
  const markerCount = () => win.evaluate(() => {
    let n = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.name === '__studio_pick_marker__') n++; });
    return n;
  });

  // Set vertex mode, dispatch a studio-pick event → 1 marker.
  await win.evaluate(() => window.__studioSetEditMode('vertex'));
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent('studio-pick', { detail: { mode: 'vertex', result: { ok: true, vertIdx: 0 } } }));
  });
  await win.waitForTimeout(150);
  expect(await markerCount()).toBe(1);

  // Additive pick adds a second vertex marker.
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent('studio-pick', { detail: { mode: 'vertex', result: { ok: true, vertIdx: 5 }, additive: true } }));
  });
  await win.waitForTimeout(150);
  expect(await markerCount()).toBe(2);

  // Replace (non-additive) collapses to 1.
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent('studio-pick', { detail: { mode: 'vertex', result: { ok: true, vertIdx: 12 } } }));
  });
  await win.waitForTimeout(150);
  expect(await markerCount()).toBe(1);

  // Re-render after seeding edges + face.
  await win.evaluate(() => {
    window.__studioAddToEditSelection('edge', [0, 1]);
    window.__studioAddToEditSelection('face', 0);
    window.__studioRenderEditSelectionMarkers();
  });
  await win.waitForTimeout(150);
  // 1 vert sphere + 1 edge line + 1 face triangle = 3.
  expect(await markerCount()).toBe(3);

  // ClearPickMarkers wipes all.
  await win.evaluate(() => window.__studioClearPickMarkers());
  await win.waitForTimeout(150);
  expect(await markerCount()).toBe(0);

  // Switch to object mode wipes the selection set too.
  await win.evaluate(() => {
    window.__studioSetEditMode('vertex');
    window.dispatchEvent(new CustomEvent('studio-pick', { detail: { mode: 'vertex', result: { ok: true, vertIdx: 3 } } }));
  });
  await win.waitForTimeout(150);
  expect(await markerCount()).toBe(1);
  await win.evaluate(() => window.__studioSetEditMode('object'));
  await win.waitForTimeout(150);
  expect(await markerCount()).toBe(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 422: vert/edge/face markers render/replace/additive/clear ok');

  await app.close();
});
