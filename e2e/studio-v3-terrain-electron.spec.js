import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-terrain');

test('Studio V3 — terrain: create/noise/setH/getH/export/colorByH (slice 678)', async () => {
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

  // 1: create
  const c = await win.evaluate(() => window.__studioCreateTerrain(20, 20, 32));
  expect(c.ok).toBe(true);
  expect(c.vertices).toBe(33 * 33);
  await win.screenshot({ path: path.join(OUT, '01-create.png') });

  // 2: add noise → vertices move on Y
  const beforeY = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    return m.geometry.attributes.position.array[1];
  }, c.uuid);
  const n = await win.evaluate(() => window.__studioTerrainAddNoise(1.5, 0.4));
  expect(n.ok).toBe(true);
  const afterY = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    return m.geometry.attributes.position.array[1];
  }, c.uuid);
  expect(afterY).not.toBe(beforeY);
  await win.screenshot({ path: path.join(OUT, '02-noise.png') });

  // 3: set / get height
  const sh = await win.evaluate(() => window.__studioTerrainSetHeight(0.5, 0.5, 5));
  expect(sh.ok).toBe(true);
  const gh = await win.evaluate(() => window.__studioTerrainGetHeight(0.5, 0.5));
  expect(gh.height).toBeCloseTo(5, 4);
  await win.screenshot({ path: path.join(OUT, '03-getH.png') });

  // 4: export heightmap
  const ex = await win.evaluate(() => window.__studioTerrainExportHeightmap());
  expect(ex.ok).toBe(true);
  expect(ex.cols).toBe(33);
  expect(ex.heights.length).toBe(33 * 33);
  expect(ex.max).toBeGreaterThanOrEqual(5);
  await win.screenshot({ path: path.join(OUT, '04-export.png') });

  // 5: color by height
  const cb = await win.evaluate(() => window.__studioTerrainColorByHeight(0x33553a, 0xefe6c8));
  expect(cb.ok).toBe(true);
  const hasColor = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    return !!m.geometry.attributes.color;
  }, c.uuid);
  expect(hasColor).toBe(true);
  await win.screenshot({ path: path.join(OUT, '05-color.png') });

  // 6: confirm material is vertex-coloured
  const vc = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return mat.vertexColors;
  }, c.uuid);
  expect(vc).toBe(true);
  await win.screenshot({ path: path.join(OUT, '06-vc.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 678: 6 terrain features verified — verts', c.vertices, 'height range', ex.min.toFixed(2), '→', ex.max.toFixed(2));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
