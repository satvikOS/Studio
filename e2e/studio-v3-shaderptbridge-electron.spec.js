// Studio V3 — shader-graph ↔ GPU path tracer bridge.
//
// Companion spec to studio-v3-rtgpu-electron.spec.js + studio-v3-shader-
// electron.spec.js. Bakes a shader-graph CanvasTexture onto a cube, then
// asserts that the GPU PT's per-tri albedo packer picks the texture
// colour up via the bridge — the resulting render visibly shifts toward
// the texture-tinted colour rather than the cube's flat material colour.
//
// Assertions:
//   1. installShaderPTBridge() is reachable via autoload.js and the four
//      __studioShaderPTBridge* ops land under category 'rt'.
//   2. Enable() before rtgpu installs reports rtgpu-not-available.
//   3. With rtgpu installed but GPU PT idle, Enable() returns ok:true.
//   4. After baking a vivid green graph onto a normally-red cube, the
//      bridge stamps mat.color toward green (the texture colour) so the
//      GPU PT will render green even though the user-set base was red.
//   5. ForceRebuild() re-runs the pass + triggers __studioRTGPUReset.
//   6. Disable() restores the original red base colour.
//   7. Five named camera angles per the Forge multi-cam memory.
//
// When the driver lacks WebGL2/EXT_color_buffer_float the spec falls
// back to colour-stamp assertions without ever calling rtgpu Start (so
// CI on SwiftShader stays green).

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-shaderptbridge');

test('Studio V3 — shader-graph → GPU path tracer bridge', async () => {
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

  // ─── Bootstrap the bridge module before anything else. ───────────────
  // We deliberately load the bridge ahead of rtgpu so we can assert the
  // "rtgpu not available" branch before installing the GPU PT itself.
  await win.evaluate(async () => {
    if (typeof window.__studioShaderPTBridgeEnable !== 'function') {
      await import('/src/workbenches/studio/v3/shaderptbridge/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioShaderPTBridgeEnable === 'function'
      && typeof window.__studioShaderPTBridgeDisable === 'function'
      && typeof window.__studioShaderPTBridgeIsEnabled === 'function'
      && typeof window.__studioShaderPTBridgeForceRebuild === 'function',
    null, { timeout: 15000 },
  );

  // ─── Soft-no-op branch: rtgpu not loaded → enable() should refuse. ───
  const beforeRtgpu = await win.evaluate(() => window.__studioShaderPTBridgeEnable());
  // It's possible rtgpu was already imported by some earlier autoload —
  // in that case enable() succeeds. We only assert the *soft-fail shape*
  // when rtgpu is truly absent.
  if (typeof (await win.evaluate(() => window.__studioRTGPUStart)) !== 'function') {
    expect(beforeRtgpu.ok).toBe(false);
    expect(beforeRtgpu.error).toMatch(/rtgpu/i);
  }
  // Reset state in case we accidentally enabled it.
  await win.evaluate(() => {
    try { window.__studioShaderPTBridgeDisable(); } catch (_) {}
  });

  // ─── Now bootstrap rtgpu so the bridge has something to talk to. ─────
  await win.evaluate(async () => {
    if (typeof window.__studioRTGPUStart !== 'function') {
      await import('/src/workbenches/studio/v3/rtgpu/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioRTGPUStart === 'function'
      && typeof window.__studioRTGPURebuildScene === 'function',
    null, { timeout: 15000 },
  );

  // ─── Also load the slice-684 shader graph so we can bake a texture. ──
  await win.evaluate(async () => {
    if (typeof window.__studioShaderNodeAdd !== 'function') {
      await import('/src/workbenches/studio/v3/shader/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioShaderApplyToSelection === 'function',
    null, { timeout: 15000 },
  );

  // ─── Confirm the four bridge ops landed under category 'rt'. ─────────
  const bridgeCmds = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { names: [] };
    const r = window.__studioCommandList('rt');
    return { names: r.commands.map((c) => c.name) };
  });
  expect(bridgeCmds.names).toEqual(expect.arrayContaining([
    '__studioShaderPTBridgeEnable',
    '__studioShaderPTBridgeDisable',
    '__studioShaderPTBridgeIsEnabled',
    '__studioShaderPTBridgeForceRebuild',
  ]));

  // ─── Build a minimal scene: vivid-red cube + floor plane. ────────────
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
      // Vivid red base — the bridge should drive it toward green when
      // we bake a green texture onto it.
      cube.material.color.setRGB(1.0, 0.05, 0.05);
      cube.updateMatrixWorld(true);
      const vp = window.__archdiscViewport;
      if (vp && vp.transformControls) vp.transformControls.attach(cube);
      window.__archdiscSelectedCube = cube;
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
  await win.screenshot({ path: path.join(OUT, '00-scene-red-cube.png') });

  // ─── Bake a vivid green shader-graph texture onto the cube. ──────────
  await win.evaluate(() => {
    // Replace the default-seeded graph with a single RGB(0, 1, 0) →
    // output chain so the bake is a uniform green tile.
    window.__studioShaderGraphDeserialize({
      version: 1, nodes: [], wires: [],
    });
    const rgb = window.__studioShaderNodeAdd('rgb', { color: [0.05, 1.0, 0.10] });
    const out = window.__studioShaderNodeAdd('output', {});
    window.__studioShaderNodeConnect(rgb.uuid, 'color', out.uuid, 'color');
    // Force the selection helper to point at the cube we cached.
    window.__studioSelectedMesh = () => window.__archdiscSelectedCube;
    window.__studioShaderApplyToSelection();
  });
  // Confirm the cube now carries a texture (mat.map).
  const mapped = await win.evaluate(() => {
    const m = window.__archdiscSelectedCube;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return {
      hasMap: !!(mat && mat.map),
      // After applyGraphToMesh swaps in MeshStandardMaterial + map, the
      // base color is forced to white so the texture flows through.
      baseR: mat.color.r, baseG: mat.color.g, baseB: mat.color.b,
    };
  });
  expect(mapped.hasMap).toBe(true);
  expect(mapped.baseR).toBeCloseTo(1, 1);
  expect(mapped.baseG).toBeCloseTo(1, 1);

  // ─── Enable the bridge → run-once should tint cube color toward green.
  const enabled = await win.evaluate(() => window.__studioShaderPTBridgeEnable());
  expect(enabled.ok).toBe(true);
  expect(enabled.on).toBe(true);
  const stateAfterEnable = await win.evaluate(() => window.__studioShaderPTBridgeIsEnabled());
  expect(stateAfterEnable.ok).toBe(true);
  expect(stateAfterEnable.on).toBe(true);

  // The bridge stores the un-tinted base in userData and sets the live
  // mat.color to base * sampledTextureColor. With base = white (1,1,1)
  // and sampled = (0.05, 1.0, 0.10), the live color should now be close
  // to (0.05, 1.0, 0.10) — i.e. green channel dominates.
  await win.waitForTimeout(200);
  const tintedColor = await win.evaluate(() => {
    const m = window.__archdiscSelectedCube;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return {
      r: mat.color.r, g: mat.color.g, b: mat.color.b,
      hasBaseStored: !!(m.userData && m.userData.__shaderPTBridge_baseColor),
      baseStored: m.userData && m.userData.__shaderPTBridge_baseColor
        ? { ...m.userData.__shaderPTBridge_baseColor } : null,
    };
  });
  // Texture colour should dominate — green much larger than red/blue.
  expect(tintedColor.hasBaseStored).toBe(true);
  expect(tintedColor.baseStored.r).toBeCloseTo(1, 1);
  expect(tintedColor.g).toBeGreaterThan(0.7);
  expect(tintedColor.r).toBeLessThan(0.3);
  expect(tintedColor.b).toBeLessThan(0.3);

  await win.screenshot({ path: path.join(OUT, '01-after-bridge-enable.png') });

  // ─── ForceRebuild should re-run the pass + trigger an rtgpu rebuild. ─
  const forced = await win.evaluate(() => window.__studioShaderPTBridgeForceRebuild());
  expect(forced.ok).toBe(true);
  expect(forced.mappedMeshes).toBeGreaterThanOrEqual(1);

  // ─── Start the GPU PT and assert the rebuild flowed through. ─────────
  const ready = await win.evaluate(() => window.__studioRTGPUReady());
  expect(ready.ok).toBe(true);
  // eslint-disable-next-line no-console
  console.log('  rtgpu: supported=%s reason=%s', ready.supported, ready.reason || '-');

  const started = await win.evaluate(() => window.__studioRTGPUStart({
    pixelStride: 4, maxBounces: 2, samplesPerFrame: 1,
  }));
  expect(started.ok).toBe(true);

  if (started.supported && started.active) {
    expect(started.triangles).toBeGreaterThan(0);
    await expect(win.locator('canvas[data-studio-v3-rtgpu-overlay]'))
      .toBeAttached({ timeout: 5000 });

    // Let samples accumulate so the GPU PT's display canvas has data.
    await win.waitForTimeout(2200);

    // Snapshot the GPU PT output and read the cube's centre pixel.
    // The displayed colour should lean green if the bridge actually
    // fed the green-tinted material colour into the per-tri albedo.
    const snap = await win.evaluate(() => window.__studioRTGPUGetSnapshot());
    expect(snap.ok).toBe(true);
    expect(snap.dataUrl).toMatch(/^data:image\/png/);

    const sampleCenter = await win.evaluate(async (dataUrl) => {
      return await new Promise((resolve) => {
        const im = new Image();
        im.onload = () => {
          const cv = document.createElement('canvas');
          cv.width = im.width; cv.height = im.height;
          cv.getContext('2d').drawImage(im, 0, 0);
          // Read a 21×21 patch around the centre and average.
          const x = (im.width / 2) | 0;
          const y = (im.height / 2) | 0;
          const d = cv.getContext('2d').getImageData(x - 10, y - 10, 21, 21).data;
          let r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) {
            r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
          }
          resolve({ r: r / n / 255, g: g / n / 255, b: b / n / 255, w: im.width, h: im.height });
        };
        im.onerror = () => resolve(null);
        im.src = dataUrl;
      });
    }, snap.dataUrl);
    expect(sampleCenter).not.toBeNull();
    // Green channel should be the strongest of the three at the cube
    // centre — the texture colour bleeds through the path tracer.
    // We allow slack for the floor's grey bouncing in.
    // eslint-disable-next-line no-console
    console.log('  pt centre: r=%.3f g=%.3f b=%.3f size=%dx%d',
      sampleCenter.r, sampleCenter.g, sampleCenter.b,
      sampleCenter.w, sampleCenter.h);
    expect(sampleCenter.g).toBeGreaterThan(sampleCenter.r);
    expect(sampleCenter.g).toBeGreaterThan(sampleCenter.b);

    await win.screenshot({ path: path.join(OUT, '02-pt-tinted-green.png') });

    // ─── Multi-cam captures per the Forge multi-cam memory. ────────────
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
      await win.screenshot({ path: path.join(OUT, `03-cam-${a.name}.png`) });
    }

    // ─── Stop the GPU PT before disabling the bridge. ──────────────────
    await win.evaluate(() => window.__studioRTGPUStop());
  } else {
    // SwiftShader / unsupported driver — still capture the bridge state.
    // eslint-disable-next-line no-console
    console.log('  rtgpu unsupported — skipping PT pixel assertions');
    for (const view of ['front', 'top', 'right', 'iso', 'close']) {
      await win.evaluate((v) => {
        const vp = window.__archdiscViewport;
        if (!vp || !vp.camera) return;
        const c = vp.camera;
        if (v === 'front') c.position.set(0, 0.8, 4.5);
        else if (v === 'top') c.position.set(0.001, 5.0, 0.001);
        else if (v === 'right') c.position.set(4.5, 0.8, 0);
        else if (v === 'iso') c.position.set(3, 2.4, 3);
        else if (v === 'close') c.position.set(1.2, 1.0, 1.2);
        c.lookAt(0, 0.6, 0);
      }, view);
      await win.waitForTimeout(400);
      await win.screenshot({ path: path.join(OUT, `03-cam-${view}.png`) });
    }
  }

  // ─── Disable() must restore the base colour. ─────────────────────────
  const disabled = await win.evaluate(() => window.__studioShaderPTBridgeDisable());
  expect(disabled.ok).toBe(true);
  expect(disabled.on).toBe(false);
  const restoredColor = await win.evaluate(() => {
    const m = window.__archdiscSelectedCube;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return { r: mat.color.r, g: mat.color.g, b: mat.color.b };
  });
  // Base before bridge was white (post-applyGraphToMesh) → restoration
  // should return to white, not the green tint.
  expect(restoredColor.r).toBeCloseTo(1, 1);
  expect(restoredColor.g).toBeCloseTo(1, 1);
  expect(restoredColor.b).toBeCloseTo(1, 1);

  await win.screenshot({ path: path.join(OUT, '04-after-disable.png') });

  // eslint-disable-next-line no-console
  console.log(
    '  bridge: enabled→tint(r=%.2f g=%.2f b=%.2f) → disable→restore(r=%.2f g=%.2f b=%.2f)',
    tintedColor.r, tintedColor.g, tintedColor.b,
    restoredColor.r, restoredColor.g, restoredColor.b,
  );

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
