import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-geometry-pack');

test('Studio V3 — randomize, cast, voxelize, triangulate, decimate, spherify (slice 625)', async () => {
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

  // 1: randomize ─────────────────────────────────────────────────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const beforeRand = await win.evaluate(() => window.__studioSelectedMesh().geometry.attributes.position.array[0]);
  const rand = await win.evaluate(() => window.__studioRandomize(0.1));
  expect(rand.ok).toBe(true);
  const afterRand = await win.evaluate(() => window.__studioSelectedMesh().geometry.attributes.position.array[0]);
  expect(afterRand).not.toBe(beforeRand);
  await win.screenshot({ path: path.join(OUT, '01-randomize.png') });

  // 2: cast to sphere ────────────────────────────────────────────────────
  const cast = await win.evaluate(() => window.__studioCastToSphere(0.5, 1));
  expect(cast.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '02-cast.png') });

  // 3: voxelize ──────────────────────────────────────────────────────────
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const vox = await win.evaluate(() => window.__studioVoxelize(0.1));
  expect(vox.ok).toBe(true);
  const onGrid = await win.evaluate(() => {
    const a = window.__studioSelectedMesh().geometry.attributes.position.array;
    // every component should be a multiple of 0.1
    for (let i = 0; i < Math.min(30, a.length); i++) {
      const r = Math.abs(a[i] / 0.1 - Math.round(a[i] / 0.1));
      if (r > 1e-3) return false;
    }
    return true;
  });
  expect(onGrid).toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-voxelize.png') });

  // 4: triangulate ───────────────────────────────────────────────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const hadIdx = await win.evaluate(() => !!window.__studioSelectedMesh().geometry.index);
  expect(hadIdx).toBe(true);
  const tri = await win.evaluate(() => window.__studioTriangulate());
  expect(tri.ok).toBe(true);
  const hasIdxNow = await win.evaluate(() => !!window.__studioSelectedMesh().geometry.index);
  expect(hasIdxNow).toBe(false);
  await win.screenshot({ path: path.join(OUT, '04-triangulate.png') });

  // 5: decimate ──────────────────────────────────────────────────────────
  await win.locator('[data-studio-v3-tool="ico"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const dec = await win.evaluate(() => window.__studioDecimate(0.5));
  expect(dec.ok).toBe(true);
  expect(dec.after).toBeLessThanOrEqual(dec.before);
  await win.screenshot({ path: path.join(OUT, '05-decimate.png') });

  // 6: spherify ──────────────────────────────────────────────────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const sph = await win.evaluate(() => window.__studioSpherify(1));
  expect(sph.ok).toBe(true);
  const radii = await win.evaluate(() => {
    const a = window.__studioSelectedMesh().geometry.attributes.position.array;
    const lens = [];
    for (let i = 0; i < Math.min(15, a.length / 3); i++) {
      const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
      lens.push(Math.sqrt(x * x + y * y + z * z));
    }
    return lens;
  });
  radii.forEach((r) => expect(Math.abs(r - 1)).toBeLessThan(1e-3));
  await win.screenshot({ path: path.join(OUT, '06-spherify.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 625: 6 features verified — randomize, cast, voxelize, triangulate, decimate, spherify');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
