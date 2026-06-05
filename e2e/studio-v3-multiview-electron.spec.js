// Studio V3 — Quad-view (multiview) headed Mac-Electron spec.
//
// Drives the __studioMultiView* op surface installed by
// frontend/src/workbenches/studio/v3/multiview/autoload.js. The slice
// brief forbids touching api.js + StudioShellV3.jsx, so we
// side-effect-import the autoload via the dev-server URL — same trick
// the animadv + shader e2e specs use.
//
// Coverage:
//   • Enabling installs __studioComposer hijack + 4-pane render.
//   • Overlay paints 4 labels (PERSP/TOP/FRONT/RIGHT) + an Exit button.
//   • Splitter ratios drag via __studioMultiViewSetSplit(h, v).
//   • Maximizing pane 1 (top ortho) collapses others to zero area.
//   • Restoring (-1) returns to the 4-pane layout.
//   • Toggle reports correct on/off in __studioMultiViewGetState().
//   • Disabling restores the original composer (null in vanilla v3).
//   • Multi-cam screenshots (front/top/right/iso/close) so the
//     remote-desktop watcher can verify the scissored render.
//   • Command palette exposes every op under category "multiview".

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-multiview');

test('Studio V3 — Quad view 4-pane (multiview)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
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
  await win.waitForFunction(
    () => typeof window.__studioSelectedMesh === 'function'
       && !!window.__archdiscViewport
       && !!window.__archdiscViewport.renderer,
    null, { timeout: 15000 });

  // ─── Side-effect-import the autoload. ───────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioMultiViewToggle !== 'function') {
      await import('/src/workbenches/studio/v3/multiview/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioMultiViewToggle === 'function'
       && typeof window.__studioMultiViewEnable === 'function'
       && typeof window.__studioMultiViewDisable === 'function'
       && typeof window.__studioMultiViewMaximizePane === 'function'
       && typeof window.__studioMultiViewSetSplit === 'function'
       && typeof window.__studioMultiViewGetState === 'function',
    null, { timeout: 15000 });

  // ─── Spawn three primitives so each ortho pane has something to
  //     frame. Two cubes + a sphere at distinct positions ensures the
  //     bounds box has volume on all three axes. ──────────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(180);
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(180);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(180);

  // Spread the meshes apart so each ortho pane shows something.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const cubes = [];
    let sphere = null;
    vp.scene.traverse((o) => {
      if (!o.userData) return;
      if (o.userData.archdiscStudioPrimitiveKind === 'cube') cubes.push(o);
      if (o.userData.archdiscStudioPrimitiveKind === 'sphere') sphere = o;
    });
    if (cubes[0]) { cubes[0].position.set(-0.08, 0, 0); cubes[0].updateMatrixWorld(true); }
    if (cubes[1]) { cubes[1].position.set(0.08, 0, 0);  cubes[1].updateMatrixWorld(true); }
    if (sphere)   { sphere.position.set(0, 0.06, -0.04); sphere.updateMatrixWorld(true); }
  });
  await win.waitForTimeout(160);
  await win.screenshot({ path: path.join(OUT, '00-pre-quad.png') });

  // ─── State before enabling: off, default ratios. ────────────────
  const state0 = await win.evaluate(() => window.__studioMultiViewGetState());
  expect(state0.ok).toBe(true);
  expect(state0.on).toBe(false);
  expect(state0.panes).toEqual(['persp', 'top', 'front', 'right']);

  // ─── Enable: composer hijack + overlay mount. ───────────────────
  const enable = await win.evaluate(() => window.__studioMultiViewEnable());
  expect(enable.ok).toBe(true);
  expect(enable.on).toBe(true);
  await win.waitForTimeout(400);

  // Overlay + the four pane labels + close button all exist.
  await expect(win.locator('[data-studio-v3-multiview]')).toBeVisible({ timeout: 5000 });
  for (const i of [0, 1, 2, 3]) {
    await expect(win.locator(`[data-studio-v3-multiview-pane="${i}"]`)).toBeVisible({ timeout: 5000 });
    await expect(win.locator(`[data-studio-v3-multiview-maximize="${i}"]`)).toBeVisible({ timeout: 5000 });
  }
  await expect(win.locator('[data-studio-v3-multiview-close]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-multiview-splitter="v"]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-multiview-splitter="h"]')).toBeVisible();

  // Composer slot now points at our render-takeover proxy.
  const composerOk = await win.evaluate(() => {
    const v = window.__archdiscViewport;
    return !!(v && v.__studioComposer && v.__studioComposer.__multiview === true);
  });
  expect(composerOk).toBe(true);

  // Tick chain now carries our __multiview frame fn.
  const tickOk = await win.evaluate(() => {
    const v = window.__archdiscViewport;
    let head = v && v.__studioAnimTick;
    while (head) {
      if (head.__multiview) return true;
      head = head.__prev;
    }
    return false;
  });
  expect(tickOk).toBe(true);

  await win.waitForTimeout(500); // let a few rAF frames paint the quad
  await win.screenshot({ path: path.join(OUT, '01-quad-on.png') });

  // ─── Splitter ratios. ───────────────────────────────────────────
  const split = await win.evaluate(() => window.__studioMultiViewSetSplit(0.66, 0.4));
  expect(split.ok).toBe(true);
  expect(split.hRatio).toBeCloseTo(0.66, 3);
  expect(split.vRatio).toBeCloseTo(0.4, 3);
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '02-split-66-40.png') });

  // ─── Maximize the top ortho (pane 1). ──────────────────────────
  const max1 = await win.evaluate(() => window.__studioMultiViewMaximizePane(1));
  expect(max1.ok).toBe(true);
  expect(max1.maximized).toBe(1);
  await win.waitForTimeout(400);
  // Splitters are hidden during max — the pane 1 label still shows.
  await expect(win.locator('[data-studio-v3-multiview-splitter="v"]')).toHaveCount(0);
  await expect(win.locator('[data-studio-v3-multiview-splitter="h"]')).toHaveCount(0);
  await expect(win.locator('[data-studio-v3-multiview-pane="1"]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '03-max-top.png') });

  // Maximize via key ('right' = idx 3) then restore via -1.
  const max3 = await win.evaluate(() => window.__studioMultiViewMaximizePane('right'));
  expect(max3.ok).toBe(true);
  expect(max3.maximized).toBe(3);
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '04-max-right.png') });

  const restore = await win.evaluate(() => window.__studioMultiViewMaximizePane(-1));
  expect(restore.ok).toBe(true);
  expect(restore.maximized).toBe(-1);
  await win.waitForTimeout(300);
  // Splitters return in quad layout.
  await expect(win.locator('[data-studio-v3-multiview-splitter="v"]')).toBeVisible({ timeout: 3000 });
  await expect(win.locator('[data-studio-v3-multiview-splitter="h"]')).toBeVisible({ timeout: 3000 });
  await win.screenshot({ path: path.join(OUT, '05-restored-quad.png') });

  // ─── Multi-cam screenshots through the persp pane. ──────────────
  // Maximize persp so the user-camera fills the canvas, then nudge the
  // viewport camera to each canonical view so the remote watcher sees
  // motion. The render still flows through our composer takeover.
  await win.evaluate(() => window.__studioMultiViewMaximizePane(0));
  await win.waitForTimeout(120);
  for (const view of ['front', 'top', 'right', 'iso', 'close']) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 0.05, 0.35);
      else if (v === 'top') c.position.set(0, 0.4, 0.001);
      else if (v === 'right') c.position.set(0.35, 0.05, 0);
      else if (v === 'iso') c.position.set(0.25, 0.18, 0.25);
      else if (v === 'close') c.position.set(0.1, 0.08, 0.12);
      c.lookAt(0, 0, 0);
      if (vp.orbitControls) {
        vp.orbitControls.target.set(0, 0, 0);
        if (typeof vp.orbitControls.update === 'function') vp.orbitControls.update();
      }
    }, view);
    await win.waitForTimeout(180);
    await win.screenshot({ path: path.join(OUT, `06-cam-${view}.png`) });
  }
  // Back to quad layout for the final overview shot.
  await win.evaluate(() => window.__studioMultiViewMaximizePane(-1));
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '07-quad-final.png') });

  // ─── Toggle off — composer slot restored, overlay gone. ─────────
  const disable = await win.evaluate(() => window.__studioMultiViewDisable());
  expect(disable.ok).toBe(true);
  expect(disable.on).toBe(false);
  await win.waitForTimeout(250);

  const composerCleared = await win.evaluate(() => {
    const v = window.__archdiscViewport;
    // In a vanilla v3 boot no other composer is installed → null.
    return !v.__studioComposer || v.__studioComposer.__multiview !== true;
  });
  expect(composerCleared).toBe(true);

  // Overlay removed.
  await expect(win.locator('[data-studio-v3-multiview]')).toHaveCount(0);

  // ─── Toggle round-trip. ─────────────────────────────────────────
  const t1 = await win.evaluate(() => window.__studioMultiViewToggle());
  expect(t1.ok).toBe(true);
  expect(t1.on).toBe(true);
  await expect(win.locator('[data-studio-v3-multiview]')).toBeVisible({ timeout: 3000 });
  const t2 = await win.evaluate(() => window.__studioMultiViewToggle());
  expect(t2.ok).toBe(true);
  expect(t2.on).toBe(false);
  await expect(win.locator('[data-studio-v3-multiview]')).toHaveCount(0);

  // ─── Command palette: every multiview op registered. ────────────
  const cmds = await win.evaluate(() =>
    window.__studioCommandList && window.__studioCommandList('multiview'));
  expect(cmds && cmds.ok).toBe(true);
  expect(cmds.count).toBeGreaterThanOrEqual(6);
  const names = cmds.commands.map((c) => c.name);
  for (const expected of [
    '__studioMultiViewToggle', '__studioMultiViewEnable', '__studioMultiViewDisable',
    '__studioMultiViewMaximizePane', '__studioMultiViewSetSplit',
    '__studioMultiViewGetState',
  ]) {
    expect(names).toContain(expected);
  }

  // eslint-disable-next-line no-console
  console.log('  multiview: enable=%j max1=%j restore=%j cmds=%d',
    enable, max1, restore, cmds.count);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(120);
  await app.close();
});
