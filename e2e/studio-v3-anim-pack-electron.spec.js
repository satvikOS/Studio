import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-anim-pack');

test('Studio V3 — keyframe + play/pause/seek + list/delete (slice 629)', async () => {
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

  // Name the mesh so the track binding resolves.
  await win.evaluate(() => { window.__studioSelectedMesh().name = 'anim_cube'; });

  // 1: keyframe set at t=0 and t=1
  const k0 = await win.evaluate(() => window.__studioKeyframeSet('.position', 0, [0, 0, 0]));
  expect(k0.ok).toBe(true);
  const k1 = await win.evaluate(() => window.__studioKeyframeSet('.position', 1, [2, 1, 0]));
  expect(k1.ok).toBe(true);
  expect(k1.total).toBe(2);
  await win.screenshot({ path: path.join(OUT, '01-kfset.png') });

  // 2: list returns both
  const list = await win.evaluate(() => window.__studioKeyframeList());
  expect(list.tracks['.position'].length).toBe(2);
  await win.screenshot({ path: path.join(OUT, '02-list.png') });

  // 3: play moves the cube
  const play = await win.evaluate(() => window.__studioPlayAnimation(1));
  expect(play.ok).toBe(true);
  expect(play.tracks).toBeGreaterThanOrEqual(1);
  await win.waitForTimeout(450);
  const px = await win.evaluate(() => window.__studioSelectedMesh().position.x);
  expect(px).toBeGreaterThan(0.1);
  await win.screenshot({ path: path.join(OUT, '03-play.png') });

  // 4: pause halts progression
  const pause = await win.evaluate(() => window.__studioPauseAnimation());
  expect(pause.playing).toBe(false);
  const pxPaused = await win.evaluate(() => window.__studioSelectedMesh().position.x);
  await win.waitForTimeout(200);
  const pxStill = await win.evaluate(() => window.__studioSelectedMesh().position.x);
  expect(pxStill).toBe(pxPaused);
  await win.screenshot({ path: path.join(OUT, '04-pause.png') });

  // 5: seek snaps to t=0.5 → x≈1
  const seek = await win.evaluate(() => window.__studioSeekTime(0.5));
  expect(seek.ok).toBe(true);
  expect(seek.time).toBeCloseTo(0.5, 3);
  const pxMid = await win.evaluate(() => window.__studioSelectedMesh().position.x);
  expect(pxMid).toBeGreaterThan(0.3);
  expect(pxMid).toBeLessThan(1.7);
  await win.screenshot({ path: path.join(OUT, '05-seek.png') });

  // 6: delete a keyframe
  const del = await win.evaluate(() => window.__studioKeyframeDelete('.position', 1));
  expect(del.ok).toBe(true);
  expect(del.remaining).toBe(1);
  await win.screenshot({ path: path.join(OUT, '06-delete.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 629: 6 features — keyframe set/list/play/pause/seek/delete');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
