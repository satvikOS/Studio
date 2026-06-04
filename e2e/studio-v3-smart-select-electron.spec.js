import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-smart-select');

test('Studio V3 — smart select: polygon/material/kind/similar/fingerprint/count (slice 660)', async () => {
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

  // 2 cubes + 1 sphere with named materials
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(150);
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(150);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(150);
  await win.evaluate(() => {
    let i = 0;
    window.__archdiscScene.traverse((o) => {
      if (!o.isMesh || !o.userData?.archdiscStudioPrimitiveKind) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (mat) mat.name = i++ < 2 ? 'metal' : 'glass';
    });
  });

  // 1: polygon — wide rectangle in screen space covers everything
  const poly = await win.evaluate(() => window.__studioSelectByPolygon([
    [0, 0], [1920, 0], [1920, 1200], [0, 1200],
  ]));
  expect(poly.ok).toBe(true);
  expect(poly.count).toBeGreaterThanOrEqual(3);
  await win.screenshot({ path: path.join(OUT, '01-poly.png') });

  // 2: material name
  const mat = await win.evaluate(() => window.__studioSelectByMaterialName('metal'));
  expect(mat.count).toBe(2);
  await win.screenshot({ path: path.join(OUT, '02-matName.png') });

  // 3: kind = cube
  const k = await win.evaluate(() => window.__studioSelectByKind('cube'));
  expect(k.count).toBe(2);
  expect(k.kind).toBe('cube');
  await win.screenshot({ path: path.join(OUT, '03-kind.png') });

  // 4: similar — start from the sphere
  await win.evaluate(() => {
    const m = Array.from(window.__archdiscScene.children).find((o) => o.isMesh && o.userData?.archdiscStudioPrimitiveKind === 'sphere');
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  const sim = await win.evaluate(() => window.__studioSelectSimilar());
  expect(sim.count).toBe(1);
  expect(sim.kind).toBe('sphere');
  await win.screenshot({ path: path.join(OUT, '04-similar.png') });

  // 5: fingerprint — start from a cube
  await win.evaluate(() => {
    const m = Array.from(window.__archdiscScene.children).find((o) => o.isMesh && o.userData?.archdiscStudioPrimitiveKind === 'cube');
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  const fp = await win.evaluate(() => window.__studioSelectByGeometryFingerprint());
  expect(fp.count).toBeGreaterThanOrEqual(2);
  expect(fp.vertCount).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '05-fingerprint.png') });

  // 6: count
  const c = await win.evaluate(() => window.__studioGetSelectionCount());
  expect(c.ok).toBe(true);
  expect(typeof c.count).toBe('number');
  await win.screenshot({ path: path.join(OUT, '06-count.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 660: 6 smart-select features —', JSON.stringify({ poly: poly.count, mat: mat.count, kind: k.count, sim: sim.count, fp: fp.count }));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
