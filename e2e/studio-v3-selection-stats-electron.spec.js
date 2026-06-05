import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-selection-stats');

test('Studio V3 — selection: stats/transform/applyT/resetT/matInfo/visible (slice 681)', async () => {
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

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // 1: stats
  const s = await win.evaluate(() => window.__studioSelectionStats());
  expect(s.ok).toBe(true);
  expect(s.count).toBeGreaterThan(0);
  expect(s.vertices).toBeGreaterThan(0);
  expect(s.surfaceArea).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '01-stats.png') });

  // 2: transform readout
  const t = await win.evaluate(() => window.__studioSelectionTransform());
  expect(t.ok).toBe(true);
  expect(t.position.length).toBe(3);
  await win.screenshot({ path: path.join(OUT, '02-transform.png') });

  // 3: apply
  const ap = await win.evaluate(() => window.__studioSelectionApplyTransform({ position: [3, 1, 2], scale: [1.5, 1.5, 1.5] }));
  expect(ap.ok).toBe(true);
  const t2 = await win.evaluate(() => window.__studioSelectionTransform());
  expect(t2.position[0]).toBe(3);
  expect(t2.scale[0]).toBe(1.5);
  await win.screenshot({ path: path.join(OUT, '03-apply.png') });

  // 4: reset
  const r = await win.evaluate(() => window.__studioSelectionResetTransform());
  expect(r.ok).toBe(true);
  const t3 = await win.evaluate(() => window.__studioSelectionTransform());
  expect(t3.position).toEqual([0, 0, 0]);
  expect(t3.scale).toEqual([1, 1, 1]);
  await win.screenshot({ path: path.join(OUT, '04-reset.png') });

  // 5: material info
  const mi = await win.evaluate(() => window.__studioSelectionGetMaterialInfo());
  expect(mi.ok).toBe(true);
  expect(mi.type).toContain('Material');
  await win.screenshot({ path: path.join(OUT, '05-mat.png') });

  // 6: visible toggle
  const v = await win.evaluate(() => window.__studioSelectionSetVisible(false));
  expect(v.visible).toBe(false);
  const v2 = await win.evaluate(() => window.__studioSelectionSetVisible(true));
  expect(v2.visible).toBe(true);
  await win.screenshot({ path: path.join(OUT, '06-vis.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 681: 6 selection-stats features —', JSON.stringify({ verts: s.vertices, tris: s.triangles, area: s.surfaceArea.toFixed(2) }));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
