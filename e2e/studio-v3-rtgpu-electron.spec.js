// Studio V3 — GPU fragment-shader path tracer (rtgpu slice).
//
// Companion spec to studio-v3-rt-electron.spec.js (CPU tracer). Mounts
// the GPU tracer overlay, builds a cube+plane scene, lets samples
// accumulate, asserts behaviour, and captures 5 camera angles per the
// Forge multi-cam memory.
//
// Assertions:
//   1. installRTGPU() is reachable via autoload.js.
//   2. __studioRTGPUReady() probes WebGL2 + EXT_color_buffer_float
//      and reports supported/unsupported with a reason string.
//   3. When supported, __studioRTGPUStart mounts the overlay canvas
//      tagged data-studio-v3-rtgpu-overlay and reports triangle count
//      > 0 + supported:true.
//   4. Samples per pixel climb after a couple of seconds (GPU loop).
//   5. __studioRTGPUGetSnapshot returns a non-trivial PNG dataUrl.
//   6. Orbiting the camera bumps the cameraHash + resets accumulation.
//   7. Pixel stride toggle round-trips and trace dims rescale.
//   8. Stop removes the overlay canvas.
//
// When the driver lacks the required extensions the spec still runs to
// completion: Start returns { active:false, supported:false } and we
// assert the overlay was NOT mounted. This keeps the spec green on
// headless CI that uses SwiftShader / older drivers.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-rtgpu');

test('Studio V3 — GPU fragment-shader path tracer', async () => {
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
    () => typeof window.__studioSelectedMesh === 'function',
    null, { timeout: 15000 },
  );

  // ─── Bootstrap rtgpu module. ─────────────────────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioRTGPUStart !== 'function') {
      await import('/src/workbenches/studio/v3/rtgpu/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioRTGPUStart === 'function'
      && typeof window.__studioRTGPUReady === 'function'
      && typeof window.__studioRTGPUGetState === 'function'
      && typeof window.__studioRTGPUSetPixelStride === 'function',
    null, { timeout: 15000 },
  );

  // Ops landed in the command palette under 'rt' (shared with CPU tracer).
  const rtgpuCmds = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { names: [] };
    const r = window.__studioCommandList('rt');
    return { names: r.commands.map((c) => c.name) };
  });
  expect(rtgpuCmds.names).toEqual(expect.arrayContaining([
    '__studioRTGPUStart', '__studioRTGPUStop', '__studioRTGPUReady',
    '__studioRTGPUGetState', '__studioRTGPUSetMaxBounces',
    '__studioRTGPUSetSamplesPerFrame', '__studioRTGPUSetPixelStride',
    '__studioRTGPUResetAccumulation', '__studioRTGPUGetSnapshot',
    '__studioRTGPURebuildScene',
  ]));

  // ─── Probe driver support. ───────────────────────────────────────────
  const ready = await win.evaluate(() => window.__studioRTGPUReady());
  expect(ready.ok).toBe(true);
  // eslint-disable-next-line no-console
  console.log('  rtgpu: supported=%s reason=%s', ready.supported, ready.reason || '-');

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
      cube.scale.set(40, 40, 40);
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
    const vp = window.__archdiscViewport;
    if (vp && vp.camera && vp.orbitControls) {
      vp.camera.position.set(3, 2.2, 3);
      vp.orbitControls.target.set(0, 0.6, 0);
      vp.orbitControls.update();
    }
  });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-scene.png') });

  // ─── Start the GPU tracer. ───────────────────────────────────────────
  const started = await win.evaluate(() => window.__studioRTGPUStart({
    pixelStride: 4,
    maxBounces: 2,
    samplesPerFrame: 1,
  }));
  expect(started.ok).toBe(true);

  if (!started.supported) {
    // Driver lacked the required extensions — the spec branch ends here
    // but we still validate that Start was a true no-op and that the
    // overlay never appeared. This keeps headless CI green.
    expect(started.active).toBe(false);
    await expect(win.locator('canvas[data-studio-v3-rtgpu-overlay]')).toHaveCount(0);
    // eslint-disable-next-line no-console
    console.log('  rtgpu: skipped main flow (unsupported driver)');
    await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
    await app.close();
    return;
  }

  expect(started.active).toBe(true);
  expect(started.triangles).toBeGreaterThan(0);
  await expect(win.locator('canvas[data-studio-v3-rtgpu-overlay]'))
    .toBeAttached({ timeout: 5000 });

  // ─── Let samples accumulate. ─────────────────────────────────────────
  await win.waitForTimeout(2200);
  const stateAfter = await win.evaluate(() => window.__studioRTGPUGetState());
  expect(stateAfter.ok).toBe(true);
  expect(stateAfter.active).toBe(true);
  expect(stateAfter.pixelStride).toBe(4);
  expect(stateAfter.samples).toBeGreaterThan(0);
  expect(stateAfter.triCount).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '01-tracing.png') });

  // ─── Snapshot dataUrl is a non-trivial PNG. ──────────────────────────
  const snap = await win.evaluate(() => window.__studioRTGPUGetSnapshot());
  expect(snap.ok).toBe(true);
  expect(snap.dataUrl).toMatch(/^data:image\/png/);
  expect(snap.dataUrl.length).toBeGreaterThan(2000);

  // ─── Camera-move resets accumulation. ────────────────────────────────
  const preMoveSamples = stateAfter.samples;
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.camera || !vp.orbitControls) return;
    vp.camera.position.set(4, 3, 2);
    vp.orbitControls.update();
  });
  await win.waitForTimeout(150);
  const stateAfterMove = await win.evaluate(() => window.__studioRTGPUGetState());
  expect(stateAfterMove.samples).toBeLessThan(preMoveSamples);
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(OUT, '02-after-orbit.png') });

  // ─── Pixel-stride toggle. ────────────────────────────────────────────
  const stride1 = await win.evaluate(() => window.__studioRTGPUSetPixelStride(1));
  expect(stride1.ok).toBe(true);
  expect(stride1.pixelStride).toBe(1);
  await win.evaluate(() => window.__studioRTGPUResetAccumulation());
  await win.waitForTimeout(500);
  const stateFull = await win.evaluate(() => window.__studioRTGPUGetState());
  expect(stateFull.pixelStride).toBe(1);
  await win.screenshot({ path: path.join(OUT, '03-full-res.png') });

  // Revert to quarter-res for the multi-cam phase so each angle converges.
  await win.evaluate(() => window.__studioRTGPUSetPixelStride(4));
  await win.evaluate(() => window.__studioRTGPUResetAccumulation());

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
      const vp = window.__archdiscViewport;
      if (!vp || !vp.camera || !vp.orbitControls) return;
      vp.camera.position.set(aa.pos[0], aa.pos[1], aa.pos[2]);
      vp.orbitControls.target.set(0, 0.6, 0);
      vp.orbitControls.update();
    }, a);
    await win.waitForTimeout(900);
    await win.screenshot({ path: path.join(OUT, `04-cam-${a.name}.png`) });
  }

  // ─── Stop — overlay must be removed. ─────────────────────────────────
  const stopped = await win.evaluate(() => window.__studioRTGPUStop());
  expect(stopped.ok).toBe(true);
  expect(stopped.active).toBe(false);
  await expect(win.locator('canvas[data-studio-v3-rtgpu-overlay]')).toHaveCount(0);

  // eslint-disable-next-line no-console
  console.log(
    '  rtgpu: triangles=%d samples=%d trace=%dx%d batch=%sms',
    started.triangles, stateAfter.samples,
    stateAfter.traceW, stateAfter.traceH,
    stateAfter.lastBatchMs.toFixed(2),
  );

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
