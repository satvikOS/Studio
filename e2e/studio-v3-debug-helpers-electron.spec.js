import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-debug-helpers');

test('Studio V3 — debug helpers: bbox/vnormals/fnormals/skeleton/dirlight/clear (slice 663)', async () => {
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

  // 1: bbox helper
  const bb = await win.evaluate(() => window.__studioShowMeshBoundingBox());
  expect(bb.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-bbox.png') });

  // 2: vertex normals
  const vn = await win.evaluate(() => window.__studioShowVertexNormals(undefined, 0.1));
  expect(vn.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '02-vnormals.png') });

  // 3: face normals — fallback path is fine
  const fn = await win.evaluate(() => window.__studioShowFaceNormals(undefined, 0.1));
  expect(fn.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-fnormals.png') });

  // 4: skeleton on a non-skinned mesh returns ok=false cleanly
  const sk = await win.evaluate(() => window.__studioShowSkeleton());
  expect(sk.ok).toBe(false);
  await win.screenshot({ path: path.join(OUT, '04-skeleton.png') });

  // 5: directional light helper (the default keyLight is directional)
  const dl = await win.evaluate(() => window.__studioShowDirectionalLightHelper());
  expect(dl.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '05-dirlight.png') });

  // 6: clear all
  const hcount = await win.evaluate(() => window.__studioDebugHelpers.length);
  expect(hcount).toBeGreaterThan(0);
  const cl = await win.evaluate(() => window.__studioHideAllHelpers());
  expect(cl.ok).toBe(true);
  expect(cl.removed).toBeGreaterThan(0);
  const hcount2 = await win.evaluate(() => window.__studioDebugHelpers.length);
  expect(hcount2).toBe(0);
  await win.screenshot({ path: path.join(OUT, '06-clear.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 663: 6 debug-helper features verified — added', hcount, 'helpers');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
