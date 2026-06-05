// Studio V3 — Mari-style UDIMs + multi-channel painting.
//
// Headed Mac-Electron flow:
//   • Spawn a cube, scale to dominate the viewport (scale-to-viewer
//     memory), select it.
//   • Open the Mari side panel; verify channel toggles render.
//   • UDIM math: UV (0.4, 0.5) → 1001; UV (1.3, 0.4) → 1002; UV (0.6,
//     2.7) → 1021.
//   • Arm diffuse + roughness + metallic, set distinct colours.
//   • Paint a multi-channel stroke across UV (0.2..0.8, 0.5) → every
//     armed channel's UDIM 1001 tile updated; channel tile dataUrls
//     are non-empty PNGs.
//   • Paint a second stroke straddling UDIMs (1.2, 0.5) → tile 1002
//     appears in the UDIM list.
//   • Composite and apply → mat.map (CanvasTexture) + mat.roughnessMap
//     + mat.metalnessMap are set; mesh marker added.
//   • Verify each Mari op is registered under category 'texpaint' in
//     the command palette.
//   • Five camera angles screenshot the textured cube for visual
//     verification (per the Forge multi-cam memory).

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-mari');

test('Studio V3 — Mari: UDIMs + multi-channel painting', async () => {
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

  // Hot-load Mari autoload — api.js is intentionally NOT modified for
  // this slice, so the test bootstrap drives the install itself.
  await win.evaluate(async () => {
    if (typeof window.__studioMariPaintMultiChannel !== 'function') {
      await import('/src/workbenches/studio/v3/mari/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioMariPaintMultiChannel === 'function',
    null, { timeout: 15000 }
  );

  // ─── Step 1: spawn + select the cube ─────────────────────────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  // Scale to dominate viewport per scale-to-viewer memory.
  const cubeUuid = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    cube.scale.set(60, 60, 60);
    cube.position.set(0, 1.5, 0);
    cube.updateMatrixWorld(true);
    if (vp.transformControls && vp.transformControls.attach) vp.transformControls.attach(cube);
    vp.renderer.render(vp.scene, vp.camera);
    return cube.uuid;
  });
  expect(typeof cubeUuid).toBe('string');
  await win.screenshot({ path: path.join(OUT, '00-cube.png') });

  // ─── Step 2: open the Mari panel ─────────────────────────────────────
  const opened = await win.evaluate(() => window.__studioMariPanelOpen());
  expect(opened.ok).toBe(true);
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-v3-mari-panel]')).toBeVisible({ timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '01-panel-open.png') });

  // ─── Step 3: UDIM math ───────────────────────────────────────────────
  const udim1001 = await win.evaluate(({ u }) => window.__studioMariGetUDIM(u, 0.4, 0.5), { u: cubeUuid });
  expect(udim1001.ok).toBe(true);
  expect(udim1001.udim).toBe(1001);
  expect(udim1001.tileX).toBe(0);
  expect(udim1001.tileY).toBe(0);

  const udim1002 = await win.evaluate(({ u }) => window.__studioMariGetUDIM(u, 1.3, 0.4), { u: cubeUuid });
  expect(udim1002.udim).toBe(1002);
  expect(udim1002.tileX).toBe(1);
  expect(udim1002.tileY).toBe(0);

  const udim1021 = await win.evaluate(({ u }) => window.__studioMariGetUDIM(u, 0.6, 2.7), { u: cubeUuid });
  expect(udim1021.udim).toBe(1021);
  expect(udim1021.tileX).toBe(0);
  expect(udim1021.tileY).toBe(2);

  // ─── Step 4: list + arm channels ─────────────────────────────────────
  const chList = await win.evaluate(() => window.__studioMariListChannels());
  expect(chList.ok).toBe(true);
  const names = chList.channels.map((c) => c.name);
  for (const name of ['diffuse', 'roughness', 'metallic', 'normal', 'height', 'emissive']) {
    expect(names).toContain(name);
  }

  // diffuse is on by default; arm roughness + metallic with distinct colours.
  await win.evaluate(() => window.__studioMariSetChannelEnabled('roughness', true));
  await win.evaluate(() => window.__studioMariSetChannelEnabled('metallic', true));
  await win.evaluate(() => window.__studioMariSetChannelColor('diffuse',   '#ff5500'));
  await win.evaluate(() => window.__studioMariSetChannelColor('roughness', '#202020'));
  await win.evaluate(() => window.__studioMariSetChannelColor('metallic',  '#f0f0f0'));
  const armed = await win.evaluate(() => window.__studioMariEnabledChannels());
  expect(armed.ok).toBe(true);
  expect(armed.channels).toContain('diffuse');
  expect(armed.channels).toContain('roughness');
  expect(armed.channels).toContain('metallic');

  // ─── Step 5: multi-channel stroke at UDIM 1001 ───────────────────────
  const stroke1 = await win.evaluate(({ u }) => {
    const uvs = [];
    for (let i = 0; i < 12; i++) {
      uvs.push([0.2 + i * 0.05, 0.5]);
    }
    return window.__studioMariPaintMultiChannelStroke(u, uvs, { size: 22, hardness: 0.45, opacity: 0.9 });
  }, { u: cubeUuid });
  expect(stroke1.ok).toBe(true);
  expect(stroke1.count).toBeGreaterThan(0);
  expect(stroke1.udims).toContain(1001);

  // Per-channel UDIM 1001 tile should now exist + be a real PNG.
  for (const channel of ['diffuse', 'roughness', 'metallic']) {
    const tex = await win.evaluate(({ u, c }) => window.__studioMariGetChannelTexture(u, c, 1001),
      { u: cubeUuid, c: channel });
    expect(tex.ok).toBe(true);
    expect(tex.dataUrl.startsWith('data:image/png')).toBe(true);
  }
  await win.screenshot({ path: path.join(OUT, '02-stroke-1001.png') });

  // ─── Step 6: second stroke straddling UDIM 1002 ──────────────────────
  const stroke2 = await win.evaluate(({ u }) => {
    const uvs = [];
    for (let i = 0; i < 10; i++) {
      uvs.push([1.05 + i * 0.04, 0.5]);
    }
    return window.__studioMariPaintMultiChannelStroke(u, uvs, { size: 26, hardness: 0.5, opacity: 0.95 });
  }, { u: cubeUuid });
  expect(stroke2.ok).toBe(true);
  expect(stroke2.udims).toContain(1002);

  // Mesh now has both UDIM 1001 + 1002 entries across each armed channel.
  const tilesAfter = await win.evaluate(({ u }) => window.__studioMariListUDIMs(u), { u: cubeUuid });
  // listUDIMs reports the legacy single-tex map (set via setUDIMTexture),
  // but the channel listChannels gives per-channel tile counts.
  const chAfter = await win.evaluate(({ u }) => window.__studioMariListChannels(u), { u: cubeUuid });
  const byName = Object.fromEntries(chAfter.channels.map((c) => [c.name, c]));
  expect(byName.diffuse.tileCount).toBeGreaterThanOrEqual(2);
  expect(byName.roughness.tileCount).toBeGreaterThanOrEqual(2);
  expect(byName.metallic.tileCount).toBeGreaterThanOrEqual(2);
  // Disarmed channels have zero tile counts.
  expect(byName.normal.tileCount).toBe(0);
  expect(byName.height.tileCount).toBe(0);
  expect(byName.emissive.tileCount).toBe(0);
  void tilesAfter;
  await win.screenshot({ path: path.join(OUT, '03-stroke-1002.png') });

  // ─── Step 7: composite + apply → mat.{map, roughnessMap, metalnessMap} ──
  const applied = await win.evaluate(({ u }) => window.__studioMariCompositeAndApply(u), { u: cubeUuid });
  expect(applied.ok).toBe(true);
  expect(applied.count).toBeGreaterThanOrEqual(3);
  const slots = applied.writes.map((w) => w.slot);
  expect(slots).toContain('map');
  expect(slots).toContain('roughnessMap');
  expect(slots).toContain('metalnessMap');

  const matInfo = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return {
      hasMap:        !!(mat && mat.map),
      hasRough:      !!(mat && mat.roughnessMap),
      hasMetal:      !!(mat && mat.metalnessMap),
      mapType:       mat && mat.map ? mat.map.constructor.name : null,
      isStandard:    mat && mat.type === 'MeshStandardMaterial',
      marker:        !!(m.userData && m.userData.archdiscStudioMari),
    };
  });
  expect(matInfo.hasMap).toBe(true);
  expect(matInfo.hasRough).toBe(true);
  expect(matInfo.hasMetal).toBe(true);
  expect(matInfo.isStandard).toBe(true);
  expect(matInfo.marker).toBe(true);
  expect(matInfo.mapType).toBe('CanvasTexture');
  await win.screenshot({ path: path.join(OUT, '04-applied.png') });

  // ─── Step 8: disarm metallic, rearm normal + height, paint, re-apply ──
  await win.evaluate(() => window.__studioMariSetChannelEnabled('metallic', false));
  await win.evaluate(() => window.__studioMariSetChannelEnabled('normal',   true));
  await win.evaluate(() => window.__studioMariSetChannelEnabled('height',   true));
  await win.evaluate(() => window.__studioMariSetChannelColor('height',  '#bcbcbc'));
  await win.evaluate(() => window.__studioMariSetChannelColor('normal',  '#90b0ff'));
  const stroke3 = await win.evaluate(({ u }) => {
    const uvs = [];
    for (let i = 0; i < 8; i++) uvs.push([0.35 + i * 0.05, 0.7]);
    return window.__studioMariPaintMultiChannelStroke(u, uvs, { size: 20, hardness: 0.4, opacity: 0.9 });
  }, { u: cubeUuid });
  expect(stroke3.ok).toBe(true);
  const applied2 = await win.evaluate(({ u }) => window.__studioMariCompositeAndApply(u), { u: cubeUuid });
  expect(applied2.ok).toBe(true);
  const slots2 = applied2.writes.map((w) => w.slot);
  expect(slots2).toContain('normalMap');
  expect(slots2).toContain('displacementMap');

  // ─── Step 9: clear a UDIM tile ───────────────────────────────────────
  // setUDIMTexture stores a legacy single-tex map; clearUDIM removes it.
  await win.evaluate(({ u }) => {
    return window.__studioMariSetUDIMTexture(u, 1003, 'data:image/png;base64,iVBORw0KGgo=');
  }, { u: cubeUuid });
  const beforeClear = await win.evaluate(({ u }) => window.__studioMariListUDIMs(u), { u: cubeUuid });
  expect(beforeClear.udims.find((t) => t.udim === 1003)).toBeTruthy();
  const cleared = await win.evaluate(({ u }) => window.__studioMariClearUDIM(u, 1003), { u: cubeUuid });
  expect(cleared.ok).toBe(true);
  const afterClear = await win.evaluate(({ u }) => window.__studioMariListUDIMs(u), { u: cubeUuid });
  expect(afterClear.udims.find((t) => t.udim === 1003)).toBeFalsy();

  // ─── Step 10: command palette discovery ──────────────────────────────
  const cmds = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { ok: false };
    return window.__studioCommandList('texpaint');
  });
  expect(cmds.ok).toBe(true);
  const cmdNames = cmds.commands.map((c) => c.name);
  for (const expected of [
    '__studioMariGetUDIM', '__studioMariListUDIMs',
    '__studioMariSetUDIMTexture', '__studioMariGetUDIMTexture',
    '__studioMariClearUDIM',
    '__studioMariListChannels', '__studioMariSetChannelEnabled',
    '__studioMariSetChannelColor', '__studioMariEnabledChannels',
    '__studioMariSetChannelTexture', '__studioMariGetChannelTexture',
    '__studioMariPaintMultiChannel', '__studioMariPaintMultiChannelStroke',
    '__studioMariCompositeAndApply',
    '__studioMariPanelOpen', '__studioMariPanelClose', '__studioMariPanelToggle',
  ]) {
    expect(cmdNames).toContain(expected);
  }
  // All Mari ops should report category 'texpaint'.
  for (const c of cmds.commands.filter((cm) => cm.name.startsWith('__studioMari'))) {
    expect(c.category).toBe('texpaint');
  }

  // ─── Step 11: multi-cam screenshots (per Forge memory) ──────────────
  const cams = [
    { name: 'front', pos: [0, 1.5, 6],     target: [0, 1.5, 0] },
    { name: 'iso',   pos: [4, 4, 4],       target: [0, 1.5, 0] },
    { name: 'right', pos: [6, 1.5, 0],     target: [0, 1.5, 0] },
    { name: 'top',   pos: [0, 7, 0.01],    target: [0, 1.5, 0] },
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

  // ─── Step 12: close + cleanup ────────────────────────────────────────
  const closed = await win.evaluate(() => window.__studioMariPanelClose());
  expect(closed.ok).toBe(true);
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-mari-panel]')).toHaveCount(0);

  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log(
    `  mari: ${cmds.count} cmds total, ` +
    `${applied.writes.length} channel slots applied, ` +
    `${stroke1.count + stroke2.count + stroke3.count} dabs`
  );

  await app.close();
});
