// Studio V3 — Blender-style compositor node graph (slice compositor-1).
//
// Exercises the per-pixel RGBA compositor:
//   • dynamic-import the autoload module via the Vite dev server (api.js
//     isn't allowed to be modified by this slice, so we install ourselves
//     the same way the shader e2e does).
//   • Spawn a primitive so the viewport has something the Image node
//     can capture.
//   • Programmatic node CRUD: add RGB/cc/blur/mix/levels, wire them up,
//     evaluate, assert the output canvas + dataUrl land.
//   • Open the editor, drop a Blur node from the toolbar, click Evaluate.
//   • Serialize → deserialize round-trip.
//   • Five camera angles per the Forge multi-cam memory.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-compositor');

test('Studio V3 — compositor node graph (per-pixel RGBA pipeline)', async () => {
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

  // ─── Install the compositor (api.js isn't wired by this slice) ─────
  await win.evaluate(async () => {
    if (typeof window.__studioCompositorNodeAdd !== 'function') {
      await import('/src/workbenches/studio/v3/compositor/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioCompositorNodeAdd === 'function', null, { timeout: 15000 });

  // ─── Spawn a cube so the Image node has something to capture ──────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(400);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    if (cube) {
      cube.scale.set(40, 40, 40);
      cube.updateMatrixWorld(true);
    }
    if (vp.camera) { vp.camera.position.set(3, 3, 3); vp.camera.lookAt(0, 0, 0); }
  });
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '00-scene.png') });

  // ─── Default-seeded graph has 3 nodes (Image → ColorCorrect → Output) ─
  const seeded = await win.evaluate(() => window.__studioCompositorListNodes());
  expect(seeded.ok).toBe(true);
  expect(seeded.count).toBeGreaterThanOrEqual(3);

  // ─── Programmatic CRUD: add Blur in the middle ────────────────────
  const blur = await win.evaluate(() => window.__studioCompositorNodeAdd('blur', { radius: 6 }));
  expect(blur.ok).toBe(true);
  expect(typeof blur.uuid).toBe('string');

  // Re-wire Image → Blur → Output, dropping ColorCorrect for this test.
  const { imgId, outId } = await win.evaluate(() => {
    const list = window.__studioCompositorListNodes().nodes;
    return {
      imgId: list.find((n) => n.kind === 'image').uuid,
      outId: list.find((n) => n.kind === 'output').uuid,
    };
  });
  expect(typeof imgId).toBe('string');
  expect(typeof outId).toBe('string');

  const conn1 = await win.evaluate(({ src, dst }) =>
    window.__studioCompositorNodeConnect(src, 'image', dst, 'image'),
  { src: imgId, dst: blur.uuid });
  expect(conn1.ok).toBe(true);
  const conn2 = await win.evaluate(({ src, dst }) =>
    window.__studioCompositorNodeConnect(src, 'image', dst, 'image'),
  { src: blur.uuid, dst: outId });
  expect(conn2.ok).toBe(true);

  // ─── Evaluate. Result paints to data-studio-v3-compositor-output. ─
  const ev = await win.evaluate(() => window.__studioCompositorEvaluate());
  expect(ev.ok).toBe(true);
  expect(ev.dataUrl).toMatch(/^data:image\/png/);
  expect(ev.width).toBeGreaterThan(0);
  expect(ev.height).toBeGreaterThan(0);

  await expect(win.locator('[data-studio-v3-compositor-output]')).toBeVisible({ timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '01-evaluated-blur.png') });

  // ─── Disconnect, plug the ColorCorrect path back in, re-evaluate. ─
  await win.evaluate(({ src, dst }) =>
    window.__studioCompositorNodeDisconnect(src, 'image', dst, 'image'),
  { src: blur.uuid, dst: outId });

  // Add a Levels node and chain Image → Levels → Output.
  const lvl = await win.evaluate(() => window.__studioCompositorNodeAdd('levels', { black: 0.1, white: 0.9, gamma: 1.2 }));
  expect(lvl.ok).toBe(true);
  await win.evaluate(({ src, dst }) =>
    window.__studioCompositorNodeConnect(src, 'image', dst, 'image'),
  { src: imgId, dst: lvl.uuid });
  await win.evaluate(({ src, dst }) =>
    window.__studioCompositorNodeConnect(src, 'image', dst, 'image'),
  { src: lvl.uuid, dst: outId });

  const ev2 = await win.evaluate(() => window.__studioCompositorEvaluate());
  expect(ev2.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '02-evaluated-levels.png') });

  // ─── Add Brightness/Contrast + Mix nodes to verify two-input paths ─
  const bc = await win.evaluate(() => window.__studioCompositorNodeAdd('brightcontrast', { brightness: 0.2, contrast: 1.4 }));
  expect(bc.ok).toBe(true);
  const mix = await win.evaluate(() => window.__studioCompositorNodeAdd('mix', { op: 'screen', fac: 0.5 }));
  expect(mix.ok).toBe(true);

  await win.evaluate(({ src, dst }) =>
    window.__studioCompositorNodeConnect(src, 'image', dst, 'image'),
  { src: imgId, dst: bc.uuid });
  await win.evaluate(({ src, dst }) =>
    window.__studioCompositorNodeConnect(src, 'image', dst, 'A'),
  { src: lvl.uuid, dst: mix.uuid });
  await win.evaluate(({ src, dst }) =>
    window.__studioCompositorNodeConnect(src, 'image', dst, 'B'),
  { src: bc.uuid, dst: mix.uuid });
  // Re-route Output to take the mixed result.
  await win.evaluate(({ src, dst }) =>
    window.__studioCompositorNodeDisconnect(src, 'image', dst, 'image'),
  { src: lvl.uuid, dst: outId });
  await win.evaluate(({ src, dst }) =>
    window.__studioCompositorNodeConnect(src, 'image', dst, 'image'),
  { src: mix.uuid, dst: outId });

  const ev3 = await win.evaluate(() => window.__studioCompositorEvaluate());
  expect(ev3.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-evaluated-mix.png') });

  // ─── Serialize → wipe → restore round-trip ─────────────────────────
  const ser = await win.evaluate(() => window.__studioCompositorGraphSerialize());
  expect(ser.ok).toBe(true);
  expect(Array.isArray(ser.json.nodes)).toBe(true);
  const nodeCountBefore = ser.json.nodes.length;

  await win.evaluate(() => {
    window.__studioCompositorGraphDeserialize({ version: 1, nodes: [], wires: [] });
  });
  const empty = await win.evaluate(() => window.__studioCompositorListNodes());
  expect(empty.count).toBe(0);

  const restored = await win.evaluate((j) => window.__studioCompositorGraphDeserialize(j), ser.json);
  expect(restored.ok).toBe(true);
  expect(restored.count).toBe(nodeCountBefore);

  // ─── Editor open → DOM mounted → drop a node → close. ─────────────
  await win.evaluate(() => window.__studioCompositorEditorOpen());
  await expect(win.locator('[data-studio-v3-compositor-editor]')).toBeVisible({ timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '04-editor-open.png') });

  await win.locator('[data-studio-v3-compositor-add="blur"]').first().click();
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '05-editor-add-blur.png') });

  await win.locator('[data-studio-v3-compositor-evaluate]').click();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '06-editor-evaluate.png') });

  await win.locator('[data-studio-v3-compositor-close]').click();
  await expect(win.locator('[data-studio-v3-compositor-editor]')).toBeHidden();

  // ─── Clear the overlay output for a clean final cap. ──────────────
  await win.evaluate(() => window.__studioCompositorClearOutput());
  await win.waitForTimeout(150);

  // ─── Command-palette registration check. ──────────────────────────
  const palette = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { ok: false };
    return window.__studioCommandList('compositor');
  });
  expect(palette.ok).toBe(true);
  expect(palette.count).toBeGreaterThan(0);
  const names = (palette.commands || []).map((c) => c.name);
  expect(names).toContain('__studioCompositorEvaluate');
  expect(names).toContain('__studioCompositorEditorToggle');

  // ─── Multi-camera angles for remote-desktop verification. ─────────
  for (const view of ['front', 'top', 'right', 'iso', 'close']) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 0, 6);
      else if (v === 'top') c.position.set(0, 6, 0.001);
      else if (v === 'right') c.position.set(6, 0, 0);
      else if (v === 'iso') c.position.set(4, 4, 4);
      else if (v === 'close') c.position.set(1.5, 1.5, 1.5);
      c.lookAt(0, 0, 0);
    }, view);
    await win.waitForTimeout(200);
    // Re-evaluate at each angle so the overlay reflects the new framing.
    await win.evaluate(() => window.__studioCompositorEvaluate());
    await win.waitForTimeout(120);
    await win.screenshot({ path: path.join(OUT, `07-cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  compositor: nodes=%d palette=%d', restored.count, palette.count);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
