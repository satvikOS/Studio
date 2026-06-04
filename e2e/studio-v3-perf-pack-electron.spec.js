import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-perf-pack');

test('Studio V3 — perf: stats/fps/profile/clear/pixelRatio (slice 646)', async () => {
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

  // Add a few meshes so stats are non-zero
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // 1: scene stats
  const stats = await win.evaluate(() => window.__studioGetSceneStats());
  expect(stats.ok).toBe(true);
  expect(stats.meshes).toBeGreaterThanOrEqual(2);
  expect(stats.verts).toBeGreaterThan(0);
  expect(stats.triangles).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '01-stats.png') });

  // 2: FPS (attach + sample)
  await win.waitForTimeout(700);
  const fps = await win.evaluate(() => window.__studioGetFps());
  expect(fps.ok).toBe(true);
  expect(fps.samples).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '02-fps.png') });

  // 3: profile
  await win.evaluate(() => window.__studioStartProfile());
  await win.waitForTimeout(700);
  const prof = await win.evaluate(() => window.__studioStopProfile());
  expect(prof.ok).toBe(true);
  expect(prof.samples).toBeGreaterThan(0);
  expect(prof.avgFps).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '03-profile.png') });

  // 4: pixel ratio
  const pr = await win.evaluate(() => window.__studioSetRendererPixelRatio(0.75));
  expect(pr.ok).toBe(true);
  expect(pr.pixelRatio).toBeCloseTo(0.75, 2);
  await win.screenshot({ path: path.join(OUT, '04-pr.png') });

  // 5: clear scene
  const cl = await win.evaluate(() => window.__studioClearScene());
  expect(cl.ok).toBe(true);
  expect(cl.removed).toBeGreaterThan(0);
  const stats2 = await win.evaluate(() => window.__studioGetSceneStats());
  expect(stats2.meshes).toBe(0);
  await win.screenshot({ path: path.join(OUT, '05-clear.png') });

  // 6: cumulative profile snapshot after clear — should still work
  const fps2 = await win.evaluate(() => window.__studioGetFps());
  expect(fps2.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '06-final.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 646: 6 perf features — verts=', stats.verts, 'fps≈', fps.fps.toFixed(0), 'profile p95=', prof.p95?.toFixed(1));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
