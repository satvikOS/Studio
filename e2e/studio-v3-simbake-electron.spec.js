// ArchDisc Studio V3 — sim-bake / cache / scrub e2e.
//
// Launches Electron in --dev mode (Vite at localhost:3000) so we can
// dynamic-import simbake/autoload.js by URL even when api.js
// orchestration hasn't been wired by the slice-merge orchestrator yet
// — same trick the sim spec uses.
//
// Coverage:
//
//   1. Spawn a slice-684 cloth + a slice-684 fluid + a slice-632 particle
//      system, then install simbake.
//   2. Bake each sim for 0.5 s @ 30 fps via __studioSimBakeSource, verify
//      result shape (frames=15, kind, bytes > 0).
//   3. List sources + list bakes via the public ops.
//   4. Capture cloth vertex 144 at frame 0, scrub to frame 14, capture
//      again — must differ (we baked a sim that's actively deforming).
//   5. Bytes accounting: __studioSimBakeGetCacheBytes() total > 0,
//      perBake list matches.
//   6. Auto-play via __studioSimBakePlayCached — verify a tick link
//      tagged __simbake landed in __studioAnimTick. Pause + stop.
//   7. Clear cache for one bake, then clear all, count → 0.
//   8. Open / close / toggle the panel.
//   9. Command palette: every __studioSimBake* registered under
//      category 'sim'.
//  10. Five named camera angles per the Forge multi-cam memory.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-simbake');

test('Studio V3 — sim bake + cache + scrub', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 200,
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
  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function', null, { timeout: 15000 });

  // ─── Ensure sim + simbake autoloads have run. ───────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioClothCreate !== 'function') {
      await import('/src/workbenches/studio/v3/sim/autoload.js');
    }
    if (typeof window.__studioSimBakeSource !== 'function') {
      await import('/src/workbenches/studio/v3/simbake/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioClothCreate     === 'function'
       && typeof window.__studioFluidCreate     === 'function'
       && typeof window.__studioSimBakeSource   === 'function'
       && typeof window.__studioSimBakeScrubTo  === 'function'
       && typeof window.__studioSimBakePlayCached === 'function'
       && typeof window.__studioSimBakePanelOpen  === 'function',
    null, { timeout: 15000 },
  );

  // ─── 1. Spawn sim sources ──────────────────────────────────────────────
  const cloth = await win.evaluate(() => window.__studioClothCreate(2.0, 2.0, 16, {
    position: [0, 3, 0],
    color: 0xee4455,
    defaultPin: true,
  }));
  expect(cloth.ok).toBe(true);
  expect(cloth.count).toBe(17 * 17);

  const fluid = await win.evaluate(() => window.__studioFluidCreate(200, 3, {
    h: 0.22, restDensity: 600, viscosity: 50,
  }));
  expect(fluid.ok).toBe(true);
  expect(fluid.count).toBe(200);

  const particles = await win.evaluate(() => window.__studioCreateParticleSystem(120, {
    radius: 0.3, color1: 0xff8844, color2: 0x66ccff,
  }));
  expect(particles.ok).toBe(true);

  // ─── 2. List sources ───────────────────────────────────────────────────
  const srcList = await win.evaluate(() => window.__studioSimBakeListSources());
  expect(srcList.ok).toBe(true);
  // Three sources we just spawned (others may exist from the default scene).
  const srcUuids = srcList.sources.map((s) => s.uuid);
  expect(srcUuids).toContain(cloth.uuid);
  expect(srcUuids).toContain(fluid.uuid);
  expect(srcUuids).toContain(particles.uuid);
  // Kinds correct.
  const byUuid = Object.fromEntries(srcList.sources.map((s) => [s.uuid, s.kind]));
  expect(byUuid[cloth.uuid]).toBe('cloth');
  expect(byUuid[fluid.uuid]).toBe('fluid');
  expect(byUuid[particles.uuid]).toBe('particles');

  // ─── 3. Bake cloth + fluid + particles ─────────────────────────────────
  const bakeCloth = await win.evaluate((u) => window.__studioSimBakeSource(u, 0.5, 30), cloth.uuid);
  expect(bakeCloth.ok).toBe(true);
  expect(bakeCloth.kind).toBe('cloth');
  expect(bakeCloth.frames).toBe(15);
  expect(bakeCloth.fps).toBe(30);
  expect(bakeCloth.bytes).toBeGreaterThan(0);
  expect(bakeCloth.vertCount).toBe(17 * 17);

  const bakeFluid = await win.evaluate((u) => window.__studioSimBakeSource(u, 0.5, 30), fluid.uuid);
  expect(bakeFluid.ok).toBe(true);
  expect(bakeFluid.kind).toBe('fluid');
  expect(bakeFluid.frames).toBe(15);

  const bakeParticles = await win.evaluate((u) => window.__studioSimBakeSource(u, 0.5, 30), particles.uuid);
  expect(bakeParticles.ok).toBe(true);
  expect(bakeParticles.kind).toBe('particles');
  expect(bakeParticles.frames).toBe(15);

  await win.screenshot({ path: path.join(OUT, '01-baked.png') });

  // ─── 4. List bakes ─────────────────────────────────────────────────────
  const bakeList = await win.evaluate(() => window.__studioSimBakeListBakes());
  expect(bakeList.ok).toBe(true);
  expect(bakeList.count).toBeGreaterThanOrEqual(3);
  const baked = Object.fromEntries(bakeList.bakes.map((b) => [b.uuid, b]));
  expect(baked[cloth.uuid]).toBeTruthy();
  expect(baked[cloth.uuid].kind).toBe('cloth');

  // ─── 5. Scrub cloth: frame 0 vs frame 14 must differ ───────────────────
  // The cloth was actively sagging during the bake, so the same vertex
  // at the start vs end of the bake must show a different Y.
  await win.evaluate((u) => window.__studioSimBakeScrubTo(u, 0), cloth.uuid);
  const yAtFrame0 = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    return m.geometry.attributes.position.getY(144);
  }, cloth.uuid);
  await win.evaluate((u) => window.__studioSimBakeScrubTo(u, 14), cloth.uuid);
  const yAtFrameEnd = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    return m.geometry.attributes.position.getY(144);
  }, cloth.uuid);
  expect(Math.abs(yAtFrameEnd - yAtFrame0)).toBeGreaterThan(1e-4);

  await win.screenshot({ path: path.join(OUT, '02-scrubbed.png') });

  // ─── 6. Bytes accounting ───────────────────────────────────────────────
  const bytes = await win.evaluate(() => window.__studioSimBakeGetCacheBytes());
  expect(bytes.ok).toBe(true);
  expect(bytes.total).toBeGreaterThan(0);
  expect(bytes.perBake.length).toBeGreaterThanOrEqual(3);
  const sum = bytes.perBake.reduce((s, b) => s + b.bytes, 0);
  expect(sum).toBe(bytes.total);

  // ─── 7. Play cached + tick chain ───────────────────────────────────────
  const playCloth = await win.evaluate((u) => window.__studioSimBakePlayCached(u), cloth.uuid);
  expect(playCloth.ok).toBe(true);
  const tickHasSimbake = await win.evaluate((u) => {
    const v = window.__archdiscViewport;
    let cur = v && v.__studioAnimTick, found = false;
    while (cur) {
      if (cur.__simbake && cur.__simbakeChannel === u) { found = true; break; }
      cur = cur.__prev;
    }
    return found;
  }, cloth.uuid);
  expect(tickHasSimbake).toBe(true);

  // Let the playback tick advance a few frames.
  await win.waitForTimeout(500);
  const liveFrame = await win.evaluate((u) => window.__studioSimBakeChannelFrame(u), cloth.uuid);
  expect(liveFrame.frame).toBeGreaterThanOrEqual(0);

  const pause = await win.evaluate((u) => window.__studioSimBakePauseCached(u), cloth.uuid);
  expect(pause.ok).toBe(true);

  // Stop should splice the tick link out.
  const stop = await win.evaluate((u) => window.__studioSimBakeStopCached(u), cloth.uuid);
  expect(stop.ok).toBe(true);
  const tickClear = await win.evaluate((u) => {
    const v = window.__archdiscViewport;
    let cur = v && v.__studioAnimTick, found = false;
    while (cur) {
      if (cur.__simbake && cur.__simbakeChannel === u) { found = true; break; }
      cur = cur.__prev;
    }
    return found;
  }, cloth.uuid);
  expect(tickClear).toBe(false);

  // ─── 8. Open + close + toggle panel ────────────────────────────────────
  await win.evaluate(() => window.__studioSimBakePanelOpen());
  await expect(win.locator('[data-studio-v3-simbake-panel]')).toBeVisible({ timeout: 4000 });
  // Source rows should be present.
  await expect(win.locator(`[data-studio-v3-simbake-source="${cloth.uuid}"]`)).toBeVisible();
  // Cached bake rows + scrubber.
  await expect(win.locator(`[data-studio-v3-simbake-bake="${cloth.uuid}"]`)).toBeVisible();
  await expect(win.locator(`[data-studio-v3-simbake-scrub="${cloth.uuid}"]`)).toBeVisible();

  await win.screenshot({ path: path.join(OUT, '03-panel-open.png') });

  // Toggle closes.
  await win.evaluate(() => window.__studioSimBakePanelToggle());
  await expect(win.locator('[data-studio-v3-simbake-panel]')).toHaveCount(0, { timeout: 4000 });

  // Re-open for the multi-cam shots.
  await win.evaluate(() => window.__studioSimBakePanelOpen());
  await expect(win.locator('[data-studio-v3-simbake-panel]')).toBeVisible({ timeout: 4000 });

  // ─── 9. Clear cache ────────────────────────────────────────────────────
  const clearOne = await win.evaluate((u) => window.__studioSimBakeClearCache(u), particles.uuid);
  expect(clearOne.ok).toBe(true);
  expect(clearOne.cleared).toBe(1);
  const afterOne = await win.evaluate(() => window.__studioSimBakeCount());
  expect(afterOne.count).toBe(2);

  const clearAll = await win.evaluate(() => window.__studioSimBakeClearCache(null));
  expect(clearAll.ok).toBe(true);
  expect(clearAll.cleared).toBe(2);
  const afterAll = await win.evaluate(() => window.__studioSimBakeCount());
  expect(afterAll.count).toBe(0);

  // Re-bake one so we have something visible in the multi-cam shots.
  await win.evaluate((u) => window.__studioSimBakeSource(u, 0.5, 30), cloth.uuid);

  // ─── 10. Command palette: every __studioSimBake* under 'sim' ───────────
  const simCmds = await win.evaluate(() => window.__studioCommandList('sim'));
  expect(simCmds.ok).toBe(true);
  const names = simCmds.commands.map((c) => c.name);
  for (const expected of [
    '__studioSimBakeSource',
    '__studioSimBakeListBakes',
    '__studioSimBakeListSources',
    '__studioSimBakeScrubTo',
    '__studioSimBakePlayCached',
    '__studioSimBakePauseCached',
    '__studioSimBakeStopCached',
    '__studioSimBakeClearCache',
    '__studioSimBakeGetCacheBytes',
    '__studioSimBakePanelOpen',
    '__studioSimBakePanelClose',
    '__studioSimBakePanelToggle',
  ]) {
    expect(names).toContain(expected);
  }

  // ─── 11. Multi-cam screenshots ─────────────────────────────────────────
  const cams = [
    { name: 'front', pos: [0, 2.5, 6],  target: [0, 1.5, 0] },
    { name: 'iso',   pos: [4, 4, 4],    target: [0, 1.5, 0] },
    { name: 'right', pos: [6, 2, 0],    target: [0, 1.5, 0] },
    { name: 'top',   pos: [0, 7, 0.01], target: [0, 0, 0] },
    { name: 'close', pos: [2.5, 2, 2.5], target: [0, 1.5, 0] },
  ];
  for (const c of cams) {
    await win.evaluate(({ pos, target }) => {
      const v = window.__archdiscViewport;
      if (!v) return;
      v.camera.position.set(pos[0], pos[1], pos[2]);
      v.camera.lookAt(target[0], target[1], target[2]);
      if (v.orbitControls) {
        v.orbitControls.target.set(target[0], target[1], target[2]);
        v.orbitControls.update();
      }
      v.camera.updateMatrixWorld(true);
      v.renderer.render(v.scene, v.camera);
    }, c);
    await win.waitForTimeout(150);
    await win.screenshot({ path: path.join(OUT, `04-${c.name}.png`) });
  }

  // Teardown.
  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log(`  simbake: cloth/fluid/particles baked @ 30 fps, ` +
              `${simCmds.commands.length} sim-category commands, ` +
              `cache cleared OK`);

  await app.close();
});
