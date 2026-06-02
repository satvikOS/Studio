import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-geom-tools');

test('Studio V3 — Geometry tools weld + recompute normals (slice 565)', async () => {
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
  await win.waitForTimeout(200);

  // Op surface present.
  expect(await win.evaluate(() => typeof window.__studioWeldVertices === 'function')).toBe(true);
  expect(await win.evaluate(() => typeof window.__studioComputeVertexNormals === 'function')).toBe(true);

  // Weld at 1e-3 returns ok; counts may stay the same on a sharp box
  // because mergeVertices respects per-vertex normals + uvs. The wiring
  // is what we care about here.
  const before = await win.evaluate(() => window.__studioSelectedMesh().geometry.attributes.position.count);
  const r = await win.evaluate(() => window.__studioWeldVertices(1e-3));
  const after = await win.evaluate(() => window.__studioSelectedMesh().geometry.attributes.position.count);
  expect(r.ok).toBe(true);
  expect(after).toBeLessThanOrEqual(before);

  // Recompute normals returns ok.
  const n = await win.evaluate(() => window.__studioComputeVertexNormals());
  expect(n.ok).toBe(true);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 565: cube verts', before, '→', after, '· normals recomputed');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
