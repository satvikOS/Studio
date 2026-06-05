// Studio V3 — Mari-style projection painting (paintproj).
//
// Headed Mac-Electron flow:
//   • Spawn a cube, scale it to dominate the viewport (per the
//     "scale to viewer" memory) and select it.
//   • Open the projection-paint panel.
//   • Enter paint mode → orbit disabled, cursor = crosshair.
//   • Stamp brush at a UV coord on the cube → mat.map becomes a
//     CanvasTexture, marker installed in userData.
//   • Pick at a screen coord → returns mesh + UV.
//   • Stamp at the picked screen coord (via injected synthetic click).
//   • Project a 32×32 test PNG onto the cube from the current camera
//     viewpoint → reports >0 painted pixels.
//   • Clear the paint canvas + verify mat.map reset.
//   • Exit paint mode → orbit re-enabled.
//   • Verify every op is registered in the V3 command palette under
//     category 'texpaint'.
//   • Five camera angles screenshot the painted cube.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-paintproj');

test('Studio V3 — paintproj: Mari-style projection painting', async () => {
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

  // Hot-load the paintproj autoload (api.js will eventually wire this
  // but the spec must succeed even before that happens).
  await win.evaluate(async () => {
    if (typeof window.__studioPaintProjEnterPaintMode !== 'function') {
      await import('/src/workbenches/studio/v3/paintproj/autoload.js');
    }
  });
  await win.waitForFunction(() =>
    typeof window.__studioPaintProjEnterPaintMode === 'function'
      && typeof window.__studioPaintProjStampAtUV === 'function',
    null, { timeout: 15000 });

  // ─── Step 1: spawn + select the cube, scale to dominate viewport ────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  const cubeUuid = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    cube.scale.set(60, 60, 60);
    cube.position.set(0, 1.5, 0);
    cube.updateMatrixWorld(true);
    vp.transformControls.attach(cube);
    // Park the camera so the cube fills the frame.
    vp.camera.position.set(120, 90, 120);
    vp.camera.lookAt(0, 1.5, 0);
    if (vp.orbitControls) {
      vp.orbitControls.target.set(0, 1.5, 0);
      vp.orbitControls.update();
    }
    vp.camera.updateMatrixWorld(true);
    vp.renderer.render(vp.scene, vp.camera);
    return cube.uuid;
  });
  expect(typeof cubeUuid).toBe('string');
  await win.screenshot({ path: path.join(OUT, '00-cube.png') });

  // ─── Step 2: open the panel ──────────────────────────────────────────
  const opened = await win.evaluate(() => window.__studioPaintProjPanelOpen());
  expect(opened.ok).toBe(true);
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-v3-paintproj-panel]')).toBeVisible({ timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '01-panel-open.png') });

  // ─── Step 3: enter paint mode → orbit disabled, cursor crosshair ────
  const wasOrbit = await win.evaluate(() => {
    const o = window.__archdiscViewport && window.__archdiscViewport.orbitControls;
    return o ? !!o.enabled : null;
  });
  const enter = await win.evaluate(() => window.__studioPaintProjEnterPaintMode());
  expect(enter.ok).toBe(true);
  expect(enter.active).toBe(true);
  const orbitNow = await win.evaluate(() => {
    const o = window.__archdiscViewport && window.__archdiscViewport.orbitControls;
    return o ? !!o.enabled : null;
  });
  if (wasOrbit !== null) expect(orbitNow).toBe(false);
  const cursor = await win.evaluate(() => {
    const v = window.__archdiscViewport;
    return v && v.renderer && v.renderer.domElement ? v.renderer.domElement.style.cursor : '';
  });
  expect(cursor).toBe('crosshair');

  // ─── Step 4: set the brush ──────────────────────────────────────────
  const setb = await win.evaluate(() => window.__studioPaintProjSetBrush({
    size: 64, color: '#22ddff', opacity: 1.0, hardness: 0.7,
  }));
  expect(setb.ok).toBe(true);
  expect(setb.brush.size).toBe(64);
  expect(setb.brush.color).toBe('#22ddff');

  // ─── Step 5: stamp a brush dab at a UV coord ────────────────────────
  const stamp = await win.evaluate(({ uuid }) =>
    window.__studioPaintProjStampAtUV(uuid, 0.5, 0.5),
  { uuid: cubeUuid });
  expect(stamp.ok).toBe(true);
  expect(Array.isArray(stamp.texSize)).toBe(true);
  expect(stamp.texSize[0]).toBe(1024);

  // mat.map should now be a CanvasTexture; mesh should have the
  // paintproj marker on userData.
  const matInfo = await win.evaluate(({ uuid }) => {
    let m = null;
    window.__archdiscViewport.scene.traverse((o) => { if (o.uuid === uuid) m = o; });
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return {
      hasMap: !!(mat && mat.map),
      mapType: mat && mat.map ? mat.map.constructor.name : null,
      hasMarker: !!(m.userData && m.userData.archdiscStudioPaintProj),
      cw: mat && mat.map && mat.map.image ? mat.map.image.width : null,
      ch: mat && mat.map && mat.map.image ? mat.map.image.height : null,
    };
  }, { uuid: cubeUuid });
  expect(matInfo.hasMap).toBe(true);
  expect(matInfo.mapType).toBe('CanvasTexture');
  expect(matInfo.hasMarker).toBe(true);
  expect(matInfo.cw).toBe(1024);
  expect(matInfo.ch).toBe(1024);

  // Lay down several more dabs in a row so the result is visible.
  await win.evaluate(({ uuid }) => {
    const out = [];
    for (let i = 0; i < 10; i++) {
      const u = 0.25 + i * 0.05;
      const v = 0.4;
      out.push(window.__studioPaintProjStampAtUV(uuid, u, v, '#ff8800', 48, 1.0, 0.5));
    }
    return out;
  }, { uuid: cubeUuid });

  // ─── Step 6: pick at a screen coord ─────────────────────────────────
  const size = win.viewportSize();
  const pick = await win.evaluate(({ x, y }) => window.__studioPaintProjPickAtScreen(x, y),
    { x: Math.round(size.width / 2), y: Math.round(size.height / 2) });
  expect(pick.ok).toBe(true);
  expect(Array.isArray(pick.uv)).toBe(true);
  expect(pick.uv[0]).toBeGreaterThanOrEqual(0);
  expect(pick.uv[0]).toBeLessThanOrEqual(1);

  // ─── Step 7: inject a synthetic click → stamp at screen ─────────────
  const inject = await win.evaluate(({ x, y }) => window.__studioPaintProjInjectClick(x, y),
    { x: Math.round(size.width / 2), y: Math.round(size.height / 2) });
  expect(inject.ok).toBe(true);
  expect(Array.isArray(inject.uv)).toBe(true);

  // ─── Step 8: stats reflect the activity ─────────────────────────────
  const stats = await win.evaluate(() => window.__studioPaintProjStats());
  expect(stats.ok).toBe(true);
  expect(stats.stats.hits).toBeGreaterThanOrEqual(1);

  await win.evaluate(() => {
    const v = window.__archdiscViewport;
    v.renderer.render(v.scene, v.camera);
  });
  await win.screenshot({ path: path.join(OUT, '02-stamped.png') });

  // ─── Step 9: project an image from the camera ───────────────────────
  // Build a 32×32 magenta PNG in the browser to feed projectImage.
  const projResult = await win.evaluate(async ({ uuid }) => {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d');
    // Magenta with a green stripe so we know it's not just a noise hit.
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#00ff66';
    ctx.fillRect(0, 12, 32, 8);
    const url = c.toDataURL('image/png');
    return await window.__studioPaintProjProjectImage(uuid, url, { sampleRes: 64 });
  }, { uuid: cubeUuid });
  expect(projResult.ok).toBe(true);
  expect(projResult.pixelsPainted).toBeGreaterThan(10);
  expect(projResult.raysCast).toBe(64 * 64);

  await win.evaluate(() => {
    const v = window.__archdiscViewport;
    v.renderer.render(v.scene, v.camera);
  });
  await win.screenshot({ path: path.join(OUT, '03-projected.png') });

  // Export the canvas → must be a PNG data URL.
  const exp = await win.evaluate(({ uuid }) => window.__studioPaintProjExportDataUrl(uuid),
    { uuid: cubeUuid });
  expect(exp.ok).toBe(true);
  expect(exp.dataUrl.startsWith('data:image/png')).toBe(true);

  // ─── Step 10: clear the canvas ───────────────────────────────────────
  const cleared = await win.evaluate(({ uuid }) => window.__studioPaintProjClear(uuid),
    { uuid: cubeUuid });
  expect(cleared.ok).toBe(true);
  expect(cleared.width).toBe(1024);
  expect(cleared.height).toBe(1024);

  // ─── Step 11: exit paint mode → orbit restored ──────────────────────
  const exited = await win.evaluate(() => window.__studioPaintProjExitPaintMode());
  expect(exited.ok).toBe(true);
  expect(exited.active).toBe(false);
  const orbitAfter = await win.evaluate(() => {
    const o = window.__archdiscViewport && window.__archdiscViewport.orbitControls;
    return o ? !!o.enabled : null;
  });
  if (wasOrbit !== null) expect(orbitAfter).toBe(true);

  // Lay down a fresh splash so the multi-cam shots have something to show.
  await win.evaluate(({ uuid }) => {
    for (let i = 0; i < 12; i++) {
      const u = 0.1 + i * 0.07;
      const v = 0.45;
      window.__studioPaintProjStampAtUV(uuid, u, v, '#ffaa00', 36, 1.0, 0.5);
      window.__studioPaintProjStampAtUV(uuid, u, 0.65, '#2266ff', 36, 1.0, 0.5);
    }
  }, { uuid: cubeUuid });

  // ─── Step 12: command palette discovery ──────────────────────────────
  const cmds = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { ok: false };
    return window.__studioCommandList('texpaint');
  });
  expect(cmds.ok).toBe(true);
  const names = cmds.commands.map((c) => c.name);
  for (const expected of [
    '__studioPaintProjEnterPaintMode', '__studioPaintProjExitPaintMode',
    '__studioPaintProjSetBrush', '__studioPaintProjGetBrush',
    '__studioPaintProjStampAtUV', '__studioPaintProjStampAtScreen',
    '__studioPaintProjPickAtScreen', '__studioPaintProjProjectImage',
    '__studioPaintProjClear', '__studioPaintProjExportDataUrl',
    '__studioPaintProjPanelOpen', '__studioPaintProjPanelClose', '__studioPaintProjPanelToggle',
  ]) {
    expect(names).toContain(expected);
  }

  // ─── Step 13: multi-cam screenshots (per Forge multi-cam memory) ────
  const cams = [
    { name: 'front', pos: [0,   90, 200], target: [0, 1.5, 0] },
    { name: 'iso',   pos: [140, 130, 140], target: [0, 1.5, 0] },
    { name: 'right', pos: [200, 90,  0],  target: [0, 1.5, 0] },
    { name: 'top',   pos: [0,   220, 0.01], target: [0, 1.5, 0] },
    { name: 'close', pos: [85,  85,  85], target: [0, 1.5, 0] },
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

  // ─── Step 14: panel close ────────────────────────────────────────────
  const closed = await win.evaluate(() => window.__studioPaintProjPanelClose());
  expect(closed.ok).toBe(true);
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-paintproj-panel]')).toHaveCount(0);

  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log(`  paintproj: ${cmds.count} cmds, projected ${projResult.pixelsPainted} px, ${stats.stats.hits} brush hits`);

  await app.close();
});
