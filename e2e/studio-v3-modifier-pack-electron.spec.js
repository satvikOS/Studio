import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-modifier-pack');

test('Studio V3 — solidify, invert, weld, recenter, shading, maximize (slice 624)', async () => {
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

  // ── 1: solidify ──────────────────────────────────────────────────────
  await win.locator('[data-studio-v3-tool="plane"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const beforeSolid = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    return g.attributes.position.count;
  });
  const solid = await win.evaluate(() => window.__studioSolidify(0.1));
  expect(solid.ok).toBe(true);
  expect(solid.verts).toBe(beforeSolid * 2);
  await win.screenshot({ path: path.join(OUT, '01-solid.png') });

  // ── 2: invert normals ────────────────────────────────────────────────
  const beforeInv = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return m.geometry.attributes.normal.array[1]; // first vertex normal Y
  });
  const inv = await win.evaluate(() => window.__studioInvertNormals());
  expect(inv.ok).toBe(true);
  const afterInv = await win.evaluate(() => window.__studioSelectedMesh().geometry.attributes.normal.array[1]);
  expect(Math.sign(afterInv)).not.toBe(Math.sign(beforeInv));
  await win.screenshot({ path: path.join(OUT, '02-invert.png') });

  // ── 3: weld ──────────────────────────────────────────────────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const weld = await win.evaluate(() => window.__studioWeldByDistance(0.01));
  expect(weld.ok).toBe(true);
  expect(weld.after).toBeLessThanOrEqual(weld.before);
  await win.screenshot({ path: path.join(OUT, '03-weld.png') });

  // ── 4: recenter origin ───────────────────────────────────────────────
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.geometry.translate(2, 0, 0);
  });
  const recenter = await win.evaluate(() => window.__studioCenterOrigin());
  expect(recenter.ok).toBe(true);
  const recenterBbox = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.geometry.computeBoundingBox();
    return [m.geometry.boundingBox.min.x, m.geometry.boundingBox.max.x];
  });
  expect(recenterBbox[0]).toBeCloseTo(-recenterBbox[1], 4);
  await win.screenshot({ path: path.join(OUT, '04-recenter.png') });

  // ── 5: shading flat / smooth ─────────────────────────────────────────
  const flat = await win.evaluate(() => window.__studioShadingFlat());
  expect(flat.ok).toBe(true);
  // After flat, the 3 normals of a single triangle should be identical
  const flatEq = await win.evaluate(() => {
    const a = window.__studioSelectedMesh().geometry.attributes.normal.array;
    return a[0] === a[3] && a[3] === a[6];
  });
  expect(flatEq).toBe(true);
  const smooth = await win.evaluate(() => window.__studioShadingSmooth());
  expect(smooth.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '05-shading.png') });

  // ── 6: maximize viewport ─────────────────────────────────────────────
  const max = await win.evaluate(() => window.__studioMaximizeViewport());
  expect(max.ok).toBe(true);
  expect(max.maximized).toBe(true);
  const isMax = await win.evaluate(() => document.querySelector('[data-studio-v3-shell]').classList.contains('studio-v3-maximized'));
  expect(isMax).toBe(true);
  // toggle back so subsequent tests aren't affected
  const min = await win.evaluate(() => window.__studioMaximizeViewport());
  expect(min.maximized).toBe(false);
  await win.screenshot({ path: path.join(OUT, '06-maximize.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 624: 6 features verified — solidify, invert, weld, recenter, shading, maximize');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
