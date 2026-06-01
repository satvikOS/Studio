import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-remesh');

test('Studio V3 — DynaMesh / QuadRemesh / FieldQuadRemesh (slice 413)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioDynaMesh === 'function', null, { timeout: 15000 });

  // Spawn a cube so we have a mesh to remesh.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // DynaMesh on the active mesh.
  let r = await win.evaluate(() => window.__studioDynaMesh(20));
  expect(r.ok).toBe(true);
  expect(r.vertices).toBeGreaterThan(0);

  // Quad remesh on the (now dyna'd) mesh.
  r = await win.evaluate(() => window.__studioQuadRemesh(16));
  expect(r.ok).toBe(true);
  expect(r.vertices).toBeGreaterThan(0);

  // Field-aligned quad remesh spawns a new primitive in the scene.
  const before = await win.evaluate(() => {
    let n = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n;
  });
  r = await win.evaluate(() => window.__studioFieldQuadRemesh({ surface: 'diagwave' }));
  expect(r.ok).toBe(true);
  expect(r.quadCount).toBeGreaterThan(0);
  const after = await win.evaluate(() => {
    let n = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n;
  });
  expect(after).toBe(before + 1);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 413: dyna + quad remesh + field-quad spawn ok');

  await app.close();
});
