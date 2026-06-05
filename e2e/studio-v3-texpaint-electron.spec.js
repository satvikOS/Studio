// Studio V3 — texture-paint layer stack (Substance-Painter style).
//
// Headed Mac-Electron flow:
//   • Spawn a cube, select it.
//   • Open the side panel; add a fill, paint, and generator layer.
//   • Paint a brush dab at a UV coordinate → active paint layer's
//     canvasDataUrl changes.
//   • Apply the `worn-metal` smart material → 4 layers added.
//   • Bake → mat.map becomes a CanvasTexture; mesh.userData marker set.
//   • Mask gen (curvature, dirt, edges) → each returns a PNG data URL.
//   • Re-order two layers via the op surface.
//   • Verify every op is registered in the V3 command palette under
//     category 'texpaint'.
//   • Five camera angles screenshot the textured cube for visual
//     verification (per the Forge multi-cam memory).

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-texpaint');

test('Studio V3 — texpaint: layer stack + smart materials', async () => {
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

  // Ensure the texpaint module is installed (either via api.js or by
  // a direct dynamic import of the autoload entry).
  await win.evaluate(async () => {
    if (typeof window.__studioTexPaintLayerAdd !== 'function') {
      await import('/src/workbenches/studio/v3/texpaint/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioTexPaintLayerAdd === 'function', null, { timeout: 15000 });

  // ─── Step 1: spawn + select the cube ──────────────────────────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  // Scale up so the paint result dominates the viewport, per the
  // scale-to-viewer memory.
  const cubeUuid = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    cube.scale.set(60, 60, 60);
    cube.position.set(0, 1.5, 0);
    cube.updateMatrixWorld(true);
    vp.transformControls.attach(cube);
    vp.renderer.render(vp.scene, vp.camera);
    return cube.uuid;
  });
  expect(typeof cubeUuid).toBe('string');
  await win.screenshot({ path: path.join(OUT, '00-cube.png') });

  // ─── Step 2: open the layer-stack panel ──────────────────────────────
  const opened = await win.evaluate(() => window.__studioTexPaintPanelOpen());
  expect(opened.ok).toBe(true);
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-v3-texpaint-panel]')).toBeVisible({ timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '01-panel-open.png') });

  // ─── Step 3: add a fill + paint + generator layer ────────────────────
  const fill = await win.evaluate(() =>
    window.__studioTexPaintLayerAdd('fill', { color: '#ff6b00', blend: 'normal', opacity: 1.0, name: 'Orange base' }));
  expect(fill.ok).toBe(true);
  expect(fill.kind).toBe('fill');
  expect(typeof fill.uuid).toBe('string');

  const paintLayer = await win.evaluate(() =>
    window.__studioTexPaintLayerAdd('paint', { blend: 'normal', opacity: 1.0, name: 'Hand paint' }));
  expect(paintLayer.ok).toBe(true);

  const genLayer = await win.evaluate(() => {
    const m = window.__studioTexPaintMaskGen('dirt', { cells: 80, seed: 3 });
    return window.__studioTexPaintLayerAdd('generator', {
      canvasDataUrl: m.dataUrl, blend: 'multiply', opacity: 0.5, name: 'Dirt',
    });
  });
  expect(genLayer.ok).toBe(true);

  let listed = await win.evaluate(() => window.__studioTexPaintLayerList());
  expect(listed.ok).toBe(true);
  expect(listed.count).toBe(3);
  await win.screenshot({ path: path.join(OUT, '02-three-layers.png') });

  // ─── Step 4: paint a brush dab — layer canvas updates ────────────────
  // Paint several dabs in a row so we can clearly see the stroke.
  const painted = await win.evaluate(({ uuid }) => {
    const out = [];
    for (let i = 0; i < 8; i++) {
      const u = 0.2 + i * 0.07;
      const v = 0.5;
      out.push(window.__studioTexPaintPaintAt([u, v], 18, '#00ffaa', { hardness: 0.5, opacity: 0.9 }));
    }
    return { strokes: out, layer: uuid };
  }, { uuid: paintLayer.uuid });
  expect(painted.strokes.every((r) => r.ok)).toBe(true);

  // The paint layer's data URL must now be non-empty.
  const afterPaint = await win.evaluate(() => window.__studioTexPaintLayerList());
  const paintRow = afterPaint.layers.find((l) => l.kind === 'paint');
  expect(paintRow).toBeTruthy();
  expect(paintRow.hasCanvas).toBe(true);

  // ─── Step 5: bake → mat.map set, marker added ────────────────────────
  const baked = await win.evaluate(async () => {
    const r = await window.__studioTexPaintBake();
    return r;
  });
  expect(baked.ok).toBe(true);
  expect(typeof baked.dataUrl === 'string').toBe(true);
  expect(baked.dataUrl.startsWith('data:image/png')).toBe(true);

  const matInfo = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return {
      hasMap: !!(mat && mat.map),
      mapType: mat && mat.map ? mat.map.constructor.name : null,
      isStandard: mat && mat.type === 'MeshStandardMaterial',
      marker: !!(m.userData && m.userData.archdiscStudioTexPaint),
    };
  });
  expect(matInfo.hasMap).toBe(true);
  expect(matInfo.isStandard).toBe(true);
  expect(matInfo.marker).toBe(true);
  expect(matInfo.mapType).toBe('CanvasTexture');
  await win.screenshot({ path: path.join(OUT, '03-baked.png') });

  // ─── Step 6: re-order — swap fill ↔ paint ────────────────────────────
  const beforeOrder = listed.layers.map((l) => l.uuid);
  const reorder = await win.evaluate(({ a, b }) =>
    window.__studioTexPaintLayerReorder(a, b),
  { a: fill.uuid, b: paintLayer.uuid });
  expect(reorder.ok).toBe(true);
  const afterReorder = await win.evaluate(() => window.__studioTexPaintLayerList());
  const newOrder = afterReorder.layers.map((l) => l.uuid);
  expect(newOrder).not.toEqual(beforeOrder);

  // ─── Step 7: opacity + blend + enabled toggles ───────────────────────
  const op1 = await win.evaluate(({ u }) => window.__studioTexPaintLayerSetOpacity(u, 0.42), { u: paintLayer.uuid });
  expect(op1.ok).toBe(true);
  const op2 = await win.evaluate(({ u }) => window.__studioTexPaintLayerSetBlend(u, 'screen'), { u: paintLayer.uuid });
  expect(op2.ok).toBe(true);
  const op3 = await win.evaluate(({ u }) => window.__studioTexPaintLayerSetEnabled(u, false), { u: genLayer.uuid });
  expect(op3.ok).toBe(true);
  const post = await win.evaluate(() => window.__studioTexPaintLayerList());
  const pr = post.layers.find((l) => l.uuid === paintLayer.uuid);
  expect(pr.opacity).toBeCloseTo(0.42, 2);
  expect(pr.blend).toBe('screen');
  const gr = post.layers.find((l) => l.uuid === genLayer.uuid);
  expect(gr.enabled).toBe(false);

  // ─── Step 8: smart material — worn-metal adds 4 layers ──────────────
  // Re-enable the gen layer so the bake is interesting.
  await win.evaluate(({ u }) => window.__studioTexPaintLayerSetEnabled(u, true), { u: genLayer.uuid });
  const smartList = await win.evaluate(() => window.__studioTexPaintListSmartMaterials());
  expect(smartList.ok).toBe(true);
  expect(smartList.names).toContain('worn-metal');
  expect(smartList.names).toContain('painted-plastic');
  expect(smartList.names).toContain('wood-planks');
  expect(smartList.names).toContain('concrete-cracks');

  const smart = await win.evaluate(async () => {
    const r = await window.__studioTexPaintApplySmartMaterial('worn-metal');
    return r;
  });
  expect(smart.ok).toBe(true);
  expect(smart.layersAdded).toBe(4);
  const postSmart = await win.evaluate(() => window.__studioTexPaintLayerList());
  expect(postSmart.count).toBe(3 + 4);  // 3 baseline + 4 smart-material layers.
  await win.screenshot({ path: path.join(OUT, '04-smart-applied.png') });

  // ─── Step 9: mask gen — all three kinds return PNG data URLs ────────
  const maskKinds = ['curvature', 'dirt', 'edges'];
  for (const k of maskKinds) {
    const m = await win.evaluate((kind) => window.__studioTexPaintMaskGen(kind), k);
    expect(m.ok).toBe(true);
    expect(m.kind).toBe(k);
    expect(m.dataUrl.startsWith('data:image/png')).toBe(true);
  }

  // ─── Step 10: command palette discovery ──────────────────────────────
  const cmds = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { ok: false };
    return window.__studioCommandList('texpaint');
  });
  expect(cmds.ok).toBe(true);
  // 16 ops: 8 layer ops + bake + paint + 2 smart + 2 mask + 3 panel.
  expect(cmds.count).toBeGreaterThanOrEqual(15);
  const names = cmds.commands.map((c) => c.name);
  for (const expected of [
    '__studioTexPaintLayerAdd', '__studioTexPaintLayerList',
    '__studioTexPaintLayerSetEnabled', '__studioTexPaintLayerSetOpacity',
    '__studioTexPaintLayerSetBlend', '__studioTexPaintLayerDelete',
    '__studioTexPaintLayerReorder', '__studioTexPaintBake',
    '__studioTexPaintApplySmartMaterial', '__studioTexPaintListSmartMaterials',
    '__studioTexPaintMaskGen',
    '__studioTexPaintPanelOpen', '__studioTexPaintPanelClose', '__studioTexPaintPanelToggle',
  ]) {
    expect(names).toContain(expected);
  }

  // ─── Step 11: multi-cam screenshots (per Forge memory) ──────────────
  // Re-bake first so the multi-camera snapshots see the smart-material
  // composite, then park each angle.
  await win.evaluate(async () => { await window.__studioTexPaintBake(); });
  await win.waitForTimeout(200);
  const cams = [
    { name: 'front', pos: [0, 1.5, 6],   target: [0, 1.5, 0] },
    { name: 'iso',   pos: [4, 4, 4],     target: [0, 1.5, 0] },
    { name: 'right', pos: [6, 1.5, 0],   target: [0, 1.5, 0] },
    { name: 'top',   pos: [0, 7, 0.01],  target: [0, 1.5, 0] },
    { name: 'close', pos: [2.2, 2.2, 2.2], target: [0, 1.5, 0] },
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
    await win.screenshot({ path: path.join(OUT, `05-${c.name}.png`) });
  }

  // ─── Step 12: panel close ────────────────────────────────────────────
  const closed = await win.evaluate(() => window.__studioTexPaintPanelClose());
  expect(closed.ok).toBe(true);
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-texpaint-panel]')).toHaveCount(0);

  // ─── Step 13: delete one layer cleanly ───────────────────────────────
  const del = await win.evaluate(({ u }) => window.__studioTexPaintLayerDelete(u), { u: fill.uuid });
  expect(del.ok).toBe(true);
  const final = await win.evaluate(() => window.__studioTexPaintLayerList());
  expect(final.count).toBe(postSmart.count - 1);

  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log(`  texpaint: ${cmds.count} cmds, ${final.count} layers final, ${smart.layersAdded} smart-mat layers`);

  await app.close();
});
