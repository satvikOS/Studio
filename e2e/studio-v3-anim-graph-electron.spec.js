// Studio V3 — animation graph editor (bezier curves).
//
// Drives the curves/playback/GraphEditor surface installed by
// frontend/src/workbenches/studio/v3/anim/autoload.js. Because this
// slice can't touch api.js, the test side-effect-imports the autoload
// itself via the dev-server URL — same trick the shader e2e uses.
//
// Coverage:
//   • Pure-math sample() returns the expected bezier value at t=0/1.
//   • Adding a curve seeds two keys + makes the curve listable.
//   • Adding a third key brings the count to 3 and changes sample(0.5).
//   • Linear vs bezier vs step interpolation produce distinct samples.
//   • Play() advances time; pause() halts; setTime() scrubs back.
//   • The viewport mesh actually moves while playback is active
//     (position.y changes between samples).
//   • Editor opens, draws the curve path + keys + handles, scrubs the
//     timeline cursor, then closes.
//   • Multi-cam screenshots (front / top / right / iso / close) so the
//     remote-desktop watcher can see the motion.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-anim-graph');

test('Studio V3 — animation graph editor with bezier curves', async () => {
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

  // ─── Side-effect-import the autoload so the op surface lights up
  // even when api.js orchestration hasn't been wired by another agent. ─
  await win.evaluate(async () => {
    if (typeof window.__studioAnimCurveAdd !== 'function') {
      await import('/src/workbenches/studio/v3/anim/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioAnimCurveAdd === 'function'
       && typeof window.__studioAnimGraphEditorOpen === 'function',
    null, { timeout: 15000 },
  );

  // ─── Spawn a cube + attach as the selection. ───────────────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(400);
  const cubeUuid = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    cube.position.set(0, 0, 0);
    vp.transformControls.attach(cube);
    cube.updateMatrixWorld(true);
    return cube.uuid;
  });
  expect(typeof cubeUuid).toBe('string');
  await win.screenshot({ path: path.join(OUT, '00-cube.png') });

  // ─── Add a position.y curve. The op seeds two keys at t=0/t=1 so
  // we should see count=2 immediately. ───────────────────────────────
  const add = await win.evaluate(() => window.__studioAnimCurveAdd(undefined, 'position', 1));
  expect(add.ok).toBe(true);
  expect(typeof add.uuid).toBe('string');
  const curveUuid = add.uuid;

  let list = await win.evaluate((u) => window.__studioAnimCurveListKeys(u), curveUuid);
  expect(list.ok).toBe(true);
  expect(list.count).toBe(2);

  // ─── Sample at the endpoints — clamps to the boundary values. ─────
  const sampleAt = (uuid, t) => win.evaluate(
    ({ u, tt }) => window.__studioAnimCurveSample(u, tt),
    { u: uuid, tt: t },
  );
  let sZero = await sampleAt(curveUuid, 0);
  let sOne  = await sampleAt(curveUuid, 1);
  expect(sZero.ok).toBe(true);
  expect(sOne.ok).toBe(true);
  expect(sZero.value).toBeCloseTo(0, 5);     // mesh started at y=0
  expect(sOne.value).toBeCloseTo(0.5, 5);    // seed places the second key at v+0.5

  // ─── Replace key 1 with an explicit value & add a 3rd key. ────────
  const addKey = await win.evaluate((u) => window.__studioAnimCurveAddKey(u, 2, 1.5, { x: -0.3, y: 0 }, { x: 0.3, y: 0 }, 'bezier'), curveUuid);
  expect(addKey.ok).toBe(true);
  expect(addKey.count).toBe(3);

  // Mid-segment sample at t=0.5 should be > 0 + < 1.5 (somewhere on the
  // first segment between y=0 and y=0.5).
  const sHalf = await sampleAt(curveUuid, 0.5);
  expect(sHalf.value).toBeGreaterThan(0);
  expect(sHalf.value).toBeLessThan(0.5);

  // ─── Linear vs step ───────────────────────────────────────────────
  // Flip key 0 to step then to linear and confirm samples differ.
  const stepRes = await win.evaluate((u) => window.__studioAnimCurveSetInterp(u, 0, 'step'), curveUuid);
  expect(stepRes.ok).toBe(true);
  const sStep = await sampleAt(curveUuid, 0.5);
  expect(sStep.value).toBeCloseTo(0, 5); // step clamps to LEFT key value

  await win.evaluate((u) => window.__studioAnimCurveSetInterp(u, 0, 'linear'), curveUuid);
  const sLinear = await sampleAt(curveUuid, 0.5);
  expect(sLinear.value).toBeCloseTo(0.25, 4); // half-way between 0 and 0.5

  // Restore bezier for the rest of the test.
  await win.evaluate((u) => window.__studioAnimCurveSetInterp(u, 0, 'bezier'), curveUuid);

  // ─── Transport: play → wait → assert mesh moved. ──────────────────
  const beforeY = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    return m ? m.position.y : null;
  }, cubeUuid);
  expect(typeof beforeY).toBe('number');

  const playRes = await win.evaluate(() => window.__studioAnimPlay());
  expect(playRes.ok).toBe(true);
  expect(playRes.playing).toBe(true);

  // Let the timeline run for ~600ms — duration is 2s so we should land
  // somewhere between the first two keys.
  await win.waitForTimeout(600);
  const midY = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    return m ? m.position.y : null;
  }, cubeUuid);
  expect(midY).not.toBe(null);
  // Confidence: the y position changed (motion happened).
  expect(Math.abs(midY - beforeY)).toBeGreaterThan(0.001);

  await win.evaluate(() => window.__studioAnimPause());
  const stateAfterPause = await win.evaluate(() => window.__studioAnimGetState());
  expect(stateAfterPause.playing).toBe(false);
  expect(stateAfterPause.duration).toBeCloseTo(2, 5);

  // Scrub back to t=0 and confirm the mesh snaps to the first key value.
  const seek = await win.evaluate(() => window.__studioAnimSetTime(0));
  expect(seek.ok).toBe(true);
  expect(seek.time).toBe(0);
  const snapY = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    return m ? m.position.y : null;
  }, cubeUuid);
  expect(snapY).toBeCloseTo(0, 5);

  // ─── Editor open → DOM mounts → screenshot. ───────────────────────
  await win.evaluate(() => window.__studioAnimGraphEditorOpen());
  await expect(win.locator('[data-studio-v3-anim-graph-editor]')).toBeVisible({ timeout: 5000 });
  await expect(win.locator('[data-studio-v3-anim-svg]')).toBeVisible({ timeout: 5000 });
  // Active curve fg path renders, plus three key dots + their handles.
  await expect(win.locator(`[data-studio-v3-anim-curve-fg="${curveUuid}"]`)).toHaveCount(1);
  await expect(win.locator('[data-studio-v3-anim-key="0"]')).toHaveCount(1);
  await expect(win.locator('[data-studio-v3-anim-key="1"]')).toHaveCount(1);
  await expect(win.locator('[data-studio-v3-anim-key="2"]')).toHaveCount(1);
  await expect(win.locator('[data-studio-v3-anim-handle="in-1"]')).toHaveCount(1);
  await expect(win.locator('[data-studio-v3-anim-handle="out-1"]')).toHaveCount(1);
  await win.screenshot({ path: path.join(OUT, '01-editor-open.png') });

  // Scrub via setTime — the playhead should reposition.
  await win.evaluate(() => window.__studioAnimSetTime(1));
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '02-scrub-mid.png') });

  // Add-key button creates a 4th key at the current cursor.
  await win.locator('[data-studio-v3-anim-add-key]').click();
  await win.waitForTimeout(200);
  const after4 = await win.evaluate((u) => window.__studioAnimCurveListKeys(u), curveUuid);
  // Key at t=1 already exists so the add-key collapses to a replace —
  // count stays at 3. Move the cursor first then retry.
  expect(after4.count).toBeGreaterThanOrEqual(3);
  await win.evaluate(() => window.__studioAnimSetTime(0.4));
  await win.locator('[data-studio-v3-anim-add-key]').click();
  await win.waitForTimeout(200);
  const after5 = await win.evaluate((u) => window.__studioAnimCurveListKeys(u), curveUuid);
  expect(after5.count).toBeGreaterThanOrEqual(4);
  await win.screenshot({ path: path.join(OUT, '03-key-added.png') });

  // Toggle interp via the dropdown — pick step.
  await win.locator('[data-studio-v3-anim-key="0"]').click();
  await win.locator('[data-studio-v3-anim-interp]').selectOption('step');
  const stepKey = await win.evaluate((u) => window.__studioAnimCurveListKeys(u), curveUuid);
  expect(stepKey.keys[0].interp).toBe('step');
  await win.locator('[data-studio-v3-anim-interp]').selectOption('bezier');

  // Close the editor.
  await win.locator('[data-studio-v3-anim-close]').click();
  await expect(win.locator('[data-studio-v3-anim-graph-editor]')).toBeHidden();

  // ─── Final play to capture motion under multiple cameras. ─────────
  await win.evaluate(() => window.__studioAnimPlay());
  await win.waitForTimeout(300);

  for (const view of ['front', 'top', 'right', 'iso', 'close']) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 0.3, 0.4);
      else if (v === 'top') c.position.set(0, 0.6, 0.001);
      else if (v === 'right') c.position.set(0.4, 0.3, 0);
      else if (v === 'iso') c.position.set(0.3, 0.3, 0.3);
      else if (v === 'close') c.position.set(0.1, 0.15, 0.18);
      c.lookAt(0, 0.1, 0);
    }, view);
    await win.waitForTimeout(150);
    await win.screenshot({ path: path.join(OUT, `04-cam-${view}.png`) });
  }

  await win.evaluate(() => window.__studioAnimPause());

  // ─── Command palette registration: every op exists under "anim". ──
  const cmds = await win.evaluate(() => window.__studioCommandList && window.__studioCommandList('anim'));
  expect(cmds && cmds.ok).toBe(true);
  expect(cmds.count).toBeGreaterThanOrEqual(12);
  const names = cmds.commands.map((c) => c.name);
  for (const expected of [
    '__studioAnimCurveAdd', '__studioAnimCurveAddKey', '__studioAnimCurveListKeys',
    '__studioAnimCurveSample', '__studioAnimCurveDeleteKey', '__studioAnimCurveSetInterp',
    '__studioAnimPlay', '__studioAnimPause', '__studioAnimSetTime', '__studioAnimGetState',
    '__studioAnimGraphEditorOpen', '__studioAnimGraphEditorClose', '__studioAnimGraphEditorToggle',
  ]) {
    expect(names).toContain(expected);
  }

  // eslint-disable-next-line no-console
  console.log('  anim graph: %d keys, midY %f, snapY %f', after5.count, midY, snapY);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
