import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-geometry-health');

test('Studio V3 — geometry health: zero/dupes/holes/nonman/weld/orient (slice 665)', async () => {
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

  // Use a cube — has duplicate corner verts (24 in non-indexed form).
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // 1: zero-area face count (cube → 0)
  const z = await win.evaluate(() => window.__studioGeometryFindZeroAreaFaces());
  expect(z.ok).toBe(true);
  expect(z.zeroArea).toBe(0);
  expect(z.totalFaces).toBe(12);
  await win.screenshot({ path: path.join(OUT, '01-zero.png') });

  // 2: duplicate verts — cube has 36 verts but 8 unique corners → 28 dupes
  const d = await win.evaluate(() => window.__studioGeometryFindDuplicateVerts(1e-4));
  expect(d.ok).toBe(true);
  expect(d.duplicates).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '02-dupes.png') });

  // 3: holes — closed cube has 0 boundary edges
  const h = await win.evaluate(() => window.__studioGeometryFindHoles());
  expect(h.ok).toBe(true);
  expect(h.boundaryEdges).toBe(0);
  await win.screenshot({ path: path.join(OUT, '03-holes.png') });

  // 4: non-manifold — cube has 0
  const nm = await win.evaluate(() => window.__studioGeometryFindNonManifold());
  expect(nm.ok).toBe(true);
  expect(nm.nonManifoldEdges).toBe(0);
  await win.screenshot({ path: path.join(OUT, '04-nonman.png') });

  // 5: weld — merges dupes
  const w = await win.evaluate(() => window.__studioGeometryRepairWeld(1e-3));
  expect(w.ok).toBe(true);
  expect(w.after).toBeLessThan(w.before);
  expect(w.removed).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '05-weld.png') });

  // 6: orientation fix — verify it runs without crashing
  const o = await win.evaluate(() => window.__studioGeometryFixOrientation());
  expect(o.ok).toBe(true);
  expect(o.totalFaces).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '06-orient.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 665: 6 geo-health features — dupes', d.duplicates, 'welded', w.removed, 'flipped', o.flipped);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
