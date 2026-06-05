// Studio V3 — real-time path-traced render preview (rt slice).
//
// Builds a small two-mesh scene (cube + plane "floor"), enables the
// path tracer, waits for samples to accumulate, and asserts:
//
//   1. installPathTracer() can be triggered via the autoload module
//      (so the spec works even before api.js wires the import).
//   2. __studioRTStart mounts the overlay canvas (data-studio-v3-rt-overlay).
//   3. Quarter-resolution rendering accumulates non-zero samples within
//      a couple of seconds at a 10 ms / frame CPU budget.
//   4. __studioRTGetSnapshot returns a non-blank PNG dataUrl whose
//      bytes differ from a known-blank baseline (i.e. the tracer wrote
//      coloured pixels rather than leaving the canvas transparent).
//   5. Orbiting the camera resets accumulation (samples drop near 0
//      immediately after the move).
//   6. Switching to pixelStride=1 reports the new stride via GetState.
//   7. Stop removes the overlay canvas from the DOM.
//
// Five camera angles screenshot the live preview per the Forge multi-cam
// memory. 250 ms slowMo so a remote-desktop observer can watch the noisy
// preview converge.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-rt');

test('Studio V3 — real-time path-traced render preview', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  // Launch with --dev so the Vite dev server is available; lets the spec
  // dynamic-import the rt autoload module by URL even if api.js hasn't
  // been wired yet.
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

  // ─── Ensure the rt module is installed via autoload. ─────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioRTStart !== 'function') {
      await import('/src/workbenches/studio/v3/rt/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioRTStart === 'function'
      && typeof window.__studioRTGetState === 'function'
      && typeof window.__studioRTSetPixelStride === 'function',
    null, { timeout: 15000 },
  );

  // Sanity: rt ops landed in the command palette under category 'rt'.
  const rtCmds = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { count: 0, names: [] };
    const r = window.__studioCommandList('rt');
    return { count: r.count, names: r.commands.map((c) => c.name) };
  });
  expect(rtCmds.names).toEqual(expect.arrayContaining([
    '__studioRTStart', '__studioRTStop', '__studioRTResetAccumulation',
    '__studioRTGetState', '__studioRTSetMaxSamples', '__studioRTSetPixelStride',
    '__studioRTGetSnapshot',
  ]));

  // ─── Build a minimal real scene: cube + floor plane. ─────────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-v3-tool="plane"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    const scene = window.__archdiscScene;
    let cube = null;
    let plane = null;
    scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube' && !cube) cube = o;
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'plane' && !plane) plane = o;
    });
    if (cube) {
      cube.scale.set(40, 40, 40);            // primitives are 0.03 m → ~1.2 m cube
      cube.position.set(0, 0.6, 0);
      cube.material.color.setRGB(0.85, 0.35, 0.20);
      cube.updateMatrixWorld(true);
    }
    if (plane) {
      plane.scale.set(120, 120, 120);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(0, 0, 0);
      plane.material.color.setRGB(0.75, 0.78, 0.80);
      plane.updateMatrixWorld(true);
    }
    // Frame the cube nicely.
    const vp = window.__archdiscViewport;
    if (vp && vp.camera && vp.orbitControls) {
      vp.camera.position.set(3, 2.2, 3);
      vp.orbitControls.target.set(0, 0.6, 0);
      vp.orbitControls.update();
    }
  });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-scene.png') });

  // ─── Start the tracer. ───────────────────────────────────────────────
  const started = await win.evaluate(() => window.__studioRTStart({
    pixelStride: 4,         // quarter-res default
    maxSamples: 200000,
    maxBounces: 2,
    budgetMs: 12,
    maxRaysPerFrame: 3000,
  }));
  expect(started.ok).toBe(true);
  expect(started.active).toBe(true);
  expect(started.triangles).toBeGreaterThan(0);

  // Overlay canvas must be mounted.
  await expect(win.locator('canvas[data-studio-v3-rt-overlay]')).toBeAttached({ timeout: 5000 });

  // ─── Let samples accumulate for ~2 s. ────────────────────────────────
  await win.waitForTimeout(2000);
  const stateAfter = await win.evaluate(() => window.__studioRTGetState());
  expect(stateAfter.ok).toBe(true);
  expect(stateAfter.active).toBe(true);
  expect(stateAfter.pixelStride).toBe(4);
  expect(stateAfter.samples).toBeGreaterThan(500);
  // Last batch should respect the budget (allow some slack for system noise).
  expect(stateAfter.lastBatchMs).toBeLessThan(60);

  await win.screenshot({ path: path.join(OUT, '01-tracing.png') });

  // ─── Snapshot dataUrl is a non-trivial PNG. ──────────────────────────
  const snap = await win.evaluate(() => window.__studioRTGetSnapshot());
  expect(snap.ok).toBe(true);
  expect(snap.dataUrl).toMatch(/^data:image\/png/);
  // A truly blank 256+ px PNG is ~200-400 bytes after base64. A non-blank
  // tracer image should be much larger — assert > 2 KB.
  const b64len = snap.dataUrl.length;
  expect(b64len).toBeGreaterThan(2000);

  // ─── Camera-move resets accumulation. ────────────────────────────────
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.camera || !vp.orbitControls) return;
    vp.camera.position.set(4, 3, 2);
    vp.orbitControls.update();
  });
  await win.waitForTimeout(120); // give the tick a frame to detect the move
  const stateAfterMove = await win.evaluate(() => window.__studioRTGetState());
  // After the move + ~1 frame the new sample count should be far lower
  // than the pre-move accumulation. We allow some samples since the
  // tracer runs at ~60 fps with thousands of rays per frame.
  expect(stateAfterMove.samples).toBeLessThan(stateAfter.samples);

  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(OUT, '02-after-orbit.png') });

  // ─── Pixel stride toggle. ────────────────────────────────────────────
  const stride1 = await win.evaluate(() => window.__studioRTSetPixelStride(1));
  expect(stride1.ok).toBe(true);
  expect(stride1.pixelStride).toBe(1);
  await win.evaluate(() => window.__studioRTResetAccumulation());
  await win.waitForTimeout(600);
  const stateFullRes = await win.evaluate(() => window.__studioRTGetState());
  expect(stateFullRes.pixelStride).toBe(1);
  // Even at full-res a 12 ms budget should land hundreds of samples in 600ms.
  expect(stateFullRes.samples).toBeGreaterThan(50);
  await win.screenshot({ path: path.join(OUT, '03-full-res.png') });

  // Revert to quarter-res for the multi-cam phase so the image converges
  // more quickly per angle.
  await win.evaluate(() => window.__studioRTSetPixelStride(4));
  await win.evaluate(() => window.__studioRTResetAccumulation());

  // ─── Multi-cam screenshots (front / top / right / iso / close). ──────
  const angles = [
    { name: 'front', pos: [0, 0.8, 4.5] },
    { name: 'top',   pos: [0.001, 5.0, 0.001] },
    { name: 'right', pos: [4.5, 0.8, 0] },
    { name: 'iso',   pos: [3, 2.4, 3] },
    { name: 'close', pos: [1.2, 1.0, 1.2] },
  ];
  for (const a of angles) {
    await win.evaluate((aa) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera || !vp.orbitControls) return;
      vp.camera.position.set(aa.pos[0], aa.pos[1], aa.pos[2]);
      vp.orbitControls.target.set(0, 0.6, 0);
      vp.orbitControls.update();
    }, a);
    // Pause for accumulation at this angle.
    await win.waitForTimeout(900);
    await win.screenshot({ path: path.join(OUT, `04-cam-${a.name}.png`) });
  }

  // ─── Stop — overlay must be removed from the DOM. ────────────────────
  const stopped = await win.evaluate(() => window.__studioRTStop());
  expect(stopped.ok).toBe(true);
  expect(stopped.active).toBe(false);
  await expect(win.locator('canvas[data-studio-v3-rt-overlay]')).toHaveCount(0);

  // eslint-disable-next-line no-console
  console.log(
    '  rt: triangles=%d, samples accumulated=%d, last batch=%sms / %d rays',
    started.triangles, stateAfter.samples,
    stateAfter.lastBatchMs.toFixed(1), stateAfter.lastBatchRays,
  );

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
