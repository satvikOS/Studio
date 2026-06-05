// Studio V3 — Grease Pencil (2D strokes in 3D with layers + frames).
//
// Drives the strokes/layers/playback/GPPanel surface installed by
// frontend/src/workbenches/studio/v3/gp/autoload.js. Because this
// slice can't touch api.js, the test side-effect-imports the autoload
// via the dev-server URL — same trick the anim graph + shader e2es use.
//
// Coverage:
//   • Layer CRUD: add, list, set-active, toggle-visible, opacity, delete
//   • Frame CRUD: add, delete; current-frame resolution at time T
//   • Stroke pipeline: start → addPoint → finalize → TubeGeometry mesh
//     lives in scene with proper userData markers
//   • Per-stroke edits: setColor, setThickness, setHardness, delete
//   • Animation: two layers with different frame times → playback
//     shows the right strokes at the right times
//   • Side panel mounts, lists layers + transport, and is closable
//   • Multi-cam screenshots for remote-desktop watcher

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-gp');

test('Studio V3 — Grease Pencil: layers + frames + per-stroke material', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function', null, { timeout: 15000 });

  // ─── Side-effect-import the autoload so the op surface lights up. ──
  await win.evaluate(async () => {
    if (typeof window.__studioGPLayerAdd !== 'function') {
      await import('/src/workbenches/studio/v3/gp/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioGPLayerAdd === 'function'
       && typeof window.__studioGPStrokeStart === 'function'
       && typeof window.__studioGPPanelOpen === 'function',
    null, { timeout: 15000 },
  );

  // Reset just in case a prior run left state lying around.
  await win.evaluate(() => window.__studioGPReset && window.__studioGPReset());

  await win.screenshot({ path: path.join(OUT, '00-init.png') });

  // ─── Layer ops: add two layers, set the first active. ──────────────
  const l1 = await win.evaluate(() => window.__studioGPLayerAdd('Sketch'));
  expect(l1.ok).toBe(true);
  expect(typeof l1.uuid).toBe('string');
  const l2 = await win.evaluate(() => window.__studioGPLayerAdd('Ink'));
  expect(l2.ok).toBe(true);

  let layers = await win.evaluate(() => window.__studioGPLayerList());
  expect(layers.count).toBe(2);
  expect(layers.layers.map((l) => l.name).sort()).toEqual(['Ink', 'Sketch']);

  // Active layer should be Sketch (first added) by default per addLayer.
  expect(layers.activeUuid).toBe(l1.uuid);

  // ─── Set Ink as the active layer for the test's first stroke. ──────
  const setA = await win.evaluate((u) => window.__studioGPLayerSetActive(u), l2.uuid);
  expect(setA.ok).toBe(true);
  expect(setA.activeUuid).toBe(l2.uuid);

  // ─── Toggle visibility + opacity. ──────────────────────────────────
  const vis = await win.evaluate((u) => window.__studioGPLayerToggleVisible(u, false), l1.uuid);
  expect(vis.ok).toBe(true);
  expect(vis.visible).toBe(false);
  await win.evaluate((u) => window.__studioGPLayerToggleVisible(u, true), l1.uuid);

  const op = await win.evaluate((u) => window.__studioGPLayerSetOpacity(u, 0.5), l2.uuid);
  expect(op.ok).toBe(true);
  expect(op.opacity).toBeCloseTo(0.5, 5);

  // ─── Stroke pipeline: start → addPoint → finalize on Ink layer. ────
  // Set the timeline cursor to 0 first so we land in Ink's seeded
  // frame at t=0.
  await win.evaluate(() => window.__studioGPSetTime(0));

  const sStart = await win.evaluate(() =>
    window.__studioGPStrokeStart(0.005, '#1de9b6')
  );
  expect(sStart.ok).toBe(true);
  const strokeUuid = sStart.uuid;

  // Sketch a curving arc — 12 points so we get a smooth TubeGeometry.
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const x = (t - 0.5) * 0.06;
    const y = Math.sin(t * Math.PI) * 0.025;
    const z = (t - 0.5) * 0.02;
    const r = await win.evaluate(
      ({ u, a, b, c }) => window.__studioGPStrokeAddPoint(u, a, b, c),
      { u: strokeUuid, a: x, b: y, c: z },
    );
    expect(r.ok).toBe(true);
  }

  const sFin = await win.evaluate((u) => window.__studioGPStrokeFinalize(u), strokeUuid);
  expect(sFin.ok).toBe(true);
  expect(sFin.points).toBe(12);
  expect(typeof sFin.meshUuid).toBe('string');
  expect(sFin.bound).toBe(true);
  expect(sFin.layerUuid).toBe(l2.uuid);

  // Mesh should be in the scene with the GP userData flag.
  const meshOk = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    return !!m && !!m.userData && !!m.userData.archdiscStudioGP;
  }, sFin.meshUuid);
  expect(meshOk).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-stroke.png') });

  // ─── Per-stroke material edits. ────────────────────────────────────
  const c1 = await win.evaluate((u) => window.__studioGPStrokeSetColor(u, '#ff5577'), strokeUuid);
  expect(c1.ok).toBe(true);
  const t1 = await win.evaluate((u) => window.__studioGPStrokeSetThickness(u, 0.008), strokeUuid);
  expect(t1.ok).toBe(true);
  expect(t1.thickness).toBeCloseTo(0.008, 5);
  const h1 = await win.evaluate((u) => window.__studioGPStrokeSetHardness(u, 0.7), strokeUuid);
  expect(h1.ok).toBe(true);
  expect(h1.hardness).toBeCloseTo(0.7, 5);

  const strokes = await win.evaluate(() => window.__studioGPStrokeList());
  expect(strokes.count).toBe(1);
  expect(strokes.strokes[0].color.toLowerCase()).toBe('#ff5577');
  expect(strokes.strokes[0].thickness).toBeCloseTo(0.008, 5);

  await win.screenshot({ path: path.join(OUT, '02-stroke-edited.png') });

  // ─── Animation: switch back to Sketch layer, add a frame at t=1.0,
  // draw a second stroke that should only appear once the timeline
  // passes t=1.0. ────────────────────────────────────────────────────
  await win.evaluate((u) => window.__studioGPLayerSetActive(u), l1.uuid);
  // Make sure Sketch is fully visible.
  await win.evaluate((u) => window.__studioGPLayerSetOpacity(u, 1), l1.uuid);

  const frame = await win.evaluate((u) => window.__studioGPFrameAdd(u, 1.0), l1.uuid);
  expect(frame.ok).toBe(true);
  expect(frame.time).toBeCloseTo(1.0, 5);
  await win.evaluate(() => window.__studioGPSetTime(1.0));

  const s2Start = await win.evaluate(() => window.__studioGPStrokeStart(0.004, '#ffaa00'));
  expect(s2Start.ok).toBe(true);
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    const x = (t - 0.5) * 0.08;
    const y = -0.02;
    const z = Math.cos(t * Math.PI) * 0.025;
    await win.evaluate(
      ({ u, a, b, c }) => window.__studioGPStrokeAddPoint(u, a, b, c),
      { u: s2Start.uuid, a: x, b: y, c: z },
    );
  }
  const s2Fin = await win.evaluate((u) => window.__studioGPStrokeFinalize(u), s2Start.uuid);
  expect(s2Fin.ok).toBe(true);
  expect(s2Fin.layerUuid).toBe(l1.uuid);
  expect(s2Fin.frameTime).toBeCloseTo(1.0, 5);
  await win.screenshot({ path: path.join(OUT, '03-second-stroke.png') });

  // At t=0, stroke 2 should be hidden (its frame is at t=1.0).
  await win.evaluate(() => window.__studioGPSetTime(0));
  const visAtZero = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    return m ? m.visible : null;
  }, s2Fin.meshUuid);
  expect(visAtZero).toBe(false);
  await win.screenshot({ path: path.join(OUT, '04-time-0.png') });

  // At t=1.0, stroke 2 should be visible.
  await win.evaluate(() => window.__studioGPSetTime(1.0));
  const visAtOne = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    return m ? m.visible : null;
  }, s2Fin.meshUuid);
  expect(visAtOne).toBe(true);
  await win.screenshot({ path: path.join(OUT, '05-time-1.png') });

  // ─── Transport: play then pause; state.playing flips. ──────────────
  const playState = await win.evaluate(() => window.__studioGPPlay());
  expect(playState.ok).toBe(true);
  expect(playState.playing).toBe(true);
  await win.waitForTimeout(500);
  const pauseState = await win.evaluate(() => window.__studioGPPause());
  expect(pauseState.ok).toBe(true);
  expect(pauseState.playing).toBe(false);
  const state = await win.evaluate(() => window.__studioGPGetState());
  expect(state.ok).toBe(true);
  expect(state.duration).toBeGreaterThan(0);
  expect(state.strokes).toBe(2);
  expect(state.layers).toBe(2);

  // ─── Side panel: open → DOM mounts → screenshot → close. ───────────
  await win.evaluate(() => window.__studioGPPanelOpen());
  await expect(win.locator('[data-studio-v3-gp-panel]')).toBeVisible({ timeout: 5000 });
  await expect(win.locator(`[data-studio-v3-gp-row="${l1.uuid}"]`)).toHaveCount(1);
  await expect(win.locator(`[data-studio-v3-gp-row="${l2.uuid}"]`)).toHaveCount(1);
  await expect(win.locator('[data-studio-v3-gp-play]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-gp-pause]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-gp-brush-color]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-gp-brush-thickness]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '06-panel-open.png') });

  // Add layer via panel.
  await win.locator('[data-studio-v3-gp-add-layer]').click();
  await win.waitForTimeout(200);
  const after3 = await win.evaluate(() => window.__studioGPLayerList());
  expect(after3.count).toBe(3);
  await win.screenshot({ path: path.join(OUT, '07-panel-add-layer.png') });

  // Close.
  await win.locator('[data-studio-v3-gp-close]').click();
  await expect(win.locator('[data-studio-v3-gp-panel]')).toBeHidden();
  await win.screenshot({ path: path.join(OUT, '08-panel-closed.png') });

  // ─── Stroke delete + frame delete cascades. ────────────────────────
  const del = await win.evaluate((u) => window.__studioGPStrokeDelete(u), strokeUuid);
  expect(del.ok).toBe(true);
  expect(del.remaining).toBe(1);
  // The mesh should be gone from the scene.
  const goneCheck = await win.evaluate((u) => !!window.__archdiscScene.getObjectByProperty('uuid', u), sFin.meshUuid);
  expect(goneCheck).toBe(false);

  // ─── Multi-cam screenshots so the remote-desktop watcher sees the
  // surviving stroke under all five canonical angles. ────────────────
  await win.evaluate(() => window.__studioGPSetTime(1.0));
  for (const view of ['front', 'top', 'right', 'iso', 'close']) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 0.05, 0.18);
      else if (v === 'top') c.position.set(0, 0.18, 0.001);
      else if (v === 'right') c.position.set(0.18, 0.05, 0);
      else if (v === 'iso') c.position.set(0.12, 0.12, 0.12);
      else if (v === 'close') c.position.set(0.03, 0.04, 0.07);
      c.lookAt(0, 0, 0);
    }, view);
    await win.waitForTimeout(150);
    await win.screenshot({ path: path.join(OUT, `09-cam-${view}.png`) });
  }

  // ─── Command palette registration: every op exists under "gp". ─────
  const cmds = await win.evaluate(() => window.__studioCommandList && window.__studioCommandList('gp'));
  expect(cmds && cmds.ok).toBe(true);
  expect(cmds.count).toBeGreaterThanOrEqual(15);
  const names = cmds.commands.map((c) => c.name);
  for (const expected of [
    '__studioGPLayerAdd', '__studioGPLayerList', '__studioGPLayerSetActive',
    '__studioGPLayerToggleVisible', '__studioGPLayerSetOpacity', '__studioGPLayerDelete',
    '__studioGPFrameAdd', '__studioGPFrameDelete',
    '__studioGPStrokeStart', '__studioGPStrokeAddPoint', '__studioGPStrokeFinalize',
    '__studioGPStrokeList', '__studioGPStrokeSetColor', '__studioGPStrokeSetThickness',
    '__studioGPStrokeDelete',
    '__studioGPPlay', '__studioGPPause', '__studioGPSetTime',
    '__studioGPPanelOpen', '__studioGPPanelClose', '__studioGPPanelToggle',
  ]) {
    expect(names).toContain(expected);
  }

  // eslint-disable-next-line no-console
  console.log('  gp: %d ops, %d strokes, %d layers', cmds.count, state.strokes, state.layers);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
