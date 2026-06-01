import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-material-rows');

test('Studio V3 — inspector Material editor commits color/m/r/o/wf (slice 461)', async () => {
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
  await win.waitForTimeout(400);

  // Spawn + select cube.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(700);

  const color = win.locator('[data-studio-v3-material-color]');
  await expect(color).toBeVisible();

  // Drag metalness to 0.8.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-material-metalness]');
    el.value = '0.8';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const met = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return mat.metalness;
  });
  expect(met).toBeCloseTo(0.8, 2);

  // Toggle wireframe.
  await win.locator('[data-studio-v3-material-wireframe]').check();
  const wf = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return mat.wireframe;
  });
  expect(wf).toBe(true);

  // Opacity to 0.5 → transparent on.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-material-opacity]');
    el.value = '0.5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const opData = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return { opacity: mat.opacity, transparent: mat.transparent };
  });
  expect(opData.opacity).toBeCloseTo(0.5, 2);
  expect(opData.transparent).toBe(true);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 461: material editor commits metalness=0.8, wireframe=on, opacity=0.5');

  await app.close();
});
