import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-proc-tex');

test('Studio V3 — procedural textures: checker/gradient/noise/voronoi/stripes/dots (slice 642)', async () => {
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

  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  const checker = await win.evaluate(() => window.__studioMakeCheckerTexture(256, 0xffffff, 0x222222, 8));
  expect(checker.ok).toBe(true);
  expect(checker.applied).toBe(true);
  expect(checker.divisions).toBe(8);
  await win.screenshot({ path: path.join(OUT, '01-checker.png') });

  const grad = await win.evaluate(() => window.__studioMakeGradientTexture(256, 0x1e2a3a, 0xff8866, 'vertical'));
  expect(grad.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '02-gradient.png') });

  const noise = await win.evaluate(() => window.__studioMakeNoiseTexture(128, 4));
  expect(noise.ok).toBe(true);
  expect(noise.scale).toBe(4);
  await win.screenshot({ path: path.join(OUT, '03-noise.png') });

  const vor = await win.evaluate(() => window.__studioMakeVoronoiTexture(192, 20));
  expect(vor.ok).toBe(true);
  expect(vor.cells).toBe(20);
  await win.screenshot({ path: path.join(OUT, '04-voronoi.png') });

  const str = await win.evaluate(() => window.__studioMakeStripeTexture(256, 12, 0xffffff, 0x333333, true));
  expect(str.ok).toBe(true);
  expect(str.stripes).toBe(12);
  await win.screenshot({ path: path.join(OUT, '05-stripes.png') });

  const dots = await win.evaluate(() => window.__studioMakeDotsTexture(256, 6, 0.25));
  expect(dots.ok).toBe(true);
  expect(dots.dots).toBe(36);
  await win.screenshot({ path: path.join(OUT, '06-dots.png') });

  // The material now has the last-applied texture set as its map.
  const hasMap = await win.evaluate(() => {
    const sel = window.__studioSelectedMesh();
    const mat = Array.isArray(sel.material) ? sel.material[0] : sel.material;
    return !!(mat && mat.map);
  });
  expect(hasMap).toBe(true);

  // eslint-disable-next-line no-console
  console.log('  slice 642: 6 procedural textures verified');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
