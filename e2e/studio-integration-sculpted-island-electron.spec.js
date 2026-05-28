import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio integration — SCULPTED TROPICAL ISLAND (Video-550 parity).
 *
 * Mirrors the must-video Video-550 "block-in -> clay -> render" island:
 * a flat plane is raised into an island landmass using the LOCALIZED
 * sculpt brush (real point+radius+falloff strokes painted on the surface
 * with genuine projected pointer clicks — Draw + Inflate modes), then
 * eroded/weathered into natural rock, ringed by sea, capped with a stone
 * monument, and dressed with palms + a boulder. Proves the localized
 * brush is real: central struck verts displace far more than the
 * untouched shoreline (localized, not a global inflate).
 *
 * This scene exists because building it surfaced the gap the directive
 * calls out — Studio's sculpt brushes were whole-mesh; a localized
 * point-falloff brush (paintBrushAt, now full Blender mode set) was
 * integrated to do it, then used here as intended.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-sculpted-island');
const RAD = -Math.PI / 2;

async function tab(win, name) {
  const t = win.locator(`.workbench-ribbon-placeholder-tab[data-studio-discipline="${name}"]`);
  await t.scrollIntoViewIfNeeded(); await t.click(); await win.waitForTimeout(230);
}
async function addPrim(win, kind) { await win.locator(`[data-studio-primitive="${kind}"]`).click(); await win.waitForTimeout(210); }
async function selectLast(win) {
  await win.evaluate(() => {
    const vp = window.__archdiscViewport; let best = null, bi = -1;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { const m = /(\d+)$/.exec(o.name || ''); const i = m ? +m[1] : 0; if (i >= bi) { bi = i; best = o; } } });
    if (best && window.__studioSelectMesh) window.__studioSelectMesh(best);
  });
  await win.waitForTimeout(140);
}
async function setXform(win, p, r, s) {
  await win.evaluate(({ p, r, s }) => {
    const set = (sel, v) => { if (v == null) return; const el = document.querySelector(sel); if (!el) return; const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    if (p) { set('[data-studio-selection-edit="position-x"]', p[0]); set('[data-studio-selection-edit="position-y"]', p[1]); set('[data-studio-selection-edit="position-z"]', p[2]); }
    if (r) { set('[data-studio-selection-edit="rotation-x"]', r[0]); set('[data-studio-selection-edit="rotation-y"]', r[1]); set('[data-studio-selection-edit="rotation-z"]', r[2]); }
    if (s) { set('[data-studio-selection-edit="scale-x"]', s[0]); set('[data-studio-selection-edit="scale-y"]', s[1]); set('[data-studio-selection-edit="scale-z"]', s[2]); }
  }, { p, r, s });
  await win.waitForTimeout(120);
}
async function setMat(win, hex, emissive) {
  await win.evaluate(({ h, e }) => {
    const setV = (sel, v) => { const el = document.querySelector(sel); if (!el) return; const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    setV('[data-studio-material="color"]', h); if (e != null) setV('[data-studio-material="emissive"]', e);
  }, { h: hex, e: emissive });
  await win.waitForTimeout(120);
}
async function setRange(win, sel, val) {
  await win.evaluate(({ s, v }) => { const el = document.querySelector(s); if (!el) return; const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, { s: sel, v: val });
  await win.waitForTimeout(90);
}
async function clickAction(win, a) { const b = win.locator(`[data-studio-action="${a}"]`); await b.scrollIntoViewIfNeeded(); await b.click(); await win.waitForTimeout(190); }
async function clickRibbon(win, a) { const b = win.locator(`[data-studio-ribbon-action="${a}"]`); await b.scrollIntoViewIfNeeded(); await b.click(); await win.waitForTimeout(220); }

// Project a world point to canvas screen coords (camera-agnostic).
async function screenOf(win, wx, wy, wz) {
  return await win.evaluate(({ x, y, z }) => {
    const vp = window.__archdiscViewport; const cam = vp.camera; const c = vp.renderer.domElement; const r = c.getBoundingClientRect();
    const v = cam.position.clone(); v.set(x, y, z); v.project(cam);
    return { x: r.x + (v.x * 0.5 + 0.5) * r.width, y: r.y + (-v.y * 0.5 + 0.5) * r.height };
  }, { x: wx, y: wy, z: wz });
}
// One localized brush stroke at a world point (real pointer click).
async function stroke(win, wx, wy, wz) {
  const s = await screenOf(win, wx, wy, wz);
  await win.mouse.click(s.x, s.y);
  await win.waitForTimeout(60);
}
// Per-vertex displacement of the selected mesh since snapMesh, binned
// by distance from the local centre — proves localized vs global.
async function snapMesh(win) {
  await win.evaluate(() => { const m = window.__studioSelectedMesh(); const p = m && m.geometry && m.geometry.attributes.position; window.__isl = p ? Float32Array.from(p.array) : null; });
}
async function regionDisp(win) {
  return await win.evaluate(() => {
    const m = window.__studioSelectedMesh(); if (!m || !m.geometry) return { center: 0, edge: 0, topo: true };
    const p = m.geometry.attributes.position; const snap = window.__isl;
    if (!snap || snap.length !== p.array.length) return { center: 0, edge: 0, topo: true };
    // PlaneGeometry lies in LOCAL X-Y; the draw normal pushes along local
    // Z. Bin by ORIGINAL in-plane (x,y) distance from centre, normalized
    // by the plane's half-span, and measure raw vertex displacement.
    let span = 0;
    for (let i = 0; i < p.count; i++) { const ox = snap[i * 3], oy = snap[i * 3 + 1]; const r = Math.sqrt(ox * ox + oy * oy); if (r > span) span = r; }
    span = span || 1;
    let cs = 0, cn = 0, es = 0, en = 0;
    for (let i = 0; i < p.count; i++) {
      const ox = snap[i * 3], oy = snap[i * 3 + 1]; const rad = Math.sqrt(ox * ox + oy * oy) / span;
      const dx = p.array[i * 3] - snap[i * 3], dy = p.array[i * 3 + 1] - snap[i * 3 + 1], dz = p.array[i * 3 + 2] - snap[i * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (rad < 0.35) { cs += d; cn++; } else if (rad > 0.75) { es += d; en++; }
    }
    return { center: cn ? cs / cn : 0, edge: en ? es / en : 0, topo: false };
  });
}

test('Studio Integration — Sculpted Tropical Island (localized brush, Video-550 parity)', async () => {
  test.setTimeout(540000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 55 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);
  await tab(win, 'modeling');

  // ════ 1. ISLAND BASE — a flat plane laid horizontal, densified ════
  await addPrim(win, 'plane');
  await selectLast(win);
  await setXform(win, [0, 0, 0], [RAD, 0, 0], [5, 5, 5]); // lay flat, +Y normals
  await setMat(win, '#9c8a5e', 0);
  for (let i = 0; i < 4; i++) { await clickAction(win, 'subdivide-selected'); } // dense enough to carry detail

  // Frame so the plane fills the view, then snapshot for the localized proof.
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(300);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(20, 38, 1.1));
  await win.waitForTimeout(250);
  await snapMesh(win);

  // ════ 2. LOCALIZED SCULPT — raise the landmass with real strokes ══
  await tab(win, 'sculpting');
  await clickRibbon(win, 'brush-toggle');     // Brush ON
  await clickRibbon(win, 'brush-mode-draw');
  // Radius is in LOCAL geometry units; the plane's local half-span is
  // ~0.024 (geometry size before the 5x mesh scale), so keep the brush
  // well under that to stay localized rather than blanketing the plane.
  await setRange(win, '[data-studio-brush="radius"]', '0.006');
  await setRange(win, '[data-studio-brush="strength"]', '0.95');
  // Central peak — several stacked draw strokes (world coords on y=0).
  for (let i = 0; i < 6; i++) await stroke(win, 0, 0, 0);
  // Island body — a ring of strokes around the centre.
  const ring = [[0.045, 0, 0], [-0.045, 0, 0], [0, 0, 0.045], [0, 0, -0.045], [0.032, 0, 0.032], [-0.032, 0, -0.032], [0.032, 0, -0.032], [-0.032, 0, 0.032]];
  for (const [x, y, z] of ring) { await stroke(win, x, y, z); await stroke(win, x, y, z); }
  // Broad landmass — wide inflate strokes blend the strokes into one
  // raised island rather than a cluster of narrow spikes.
  await clickRibbon(win, 'brush-mode-inflate');
  await setRange(win, '[data-studio-brush="radius"]', '0.014');
  for (const [x, y, z] of [[0, 0, 0], [0.025, 0, 0.025], [-0.025, 0, -0.025], [0.025, 0, -0.025], [-0.025, 0, 0.025], [0, 0, 0]]) await stroke(win, x, y, z);

  // A stroke that lands on empty space deselects via the brush handler's
  // fallback; re-select the island so the displacement metric finds it.
  await selectLast(win);
  const disp = await regionDisp(win);
  // LOCALIZED proof: the struck centre rose far more than the shoreline
  // (raw local-unit displacement). A global inflate would move both equally.
  expect(disp.center).toBeGreaterThan(0.004);
  expect(disp.center).toBeGreaterThan(disp.edge * 3);
  await win.screenshot({ path: path.join(OUT, '01-sculpted-landmass.png'), fullPage: false });

  // ════ 3. BLEND — a couple of Smooth-brush passes fuse the strokes
  //         into one organic landmass. (Erosion/weathering is reserved
  //         for the SOLID monument + boulder — degrading a zero-thickness
  //         plane just shreds it into shards.) ═════════════════════════
  await clickRibbon(win, 'brush-mode-smooth');
  await setRange(win, '[data-studio-brush="radius"]', '0.012');
  for (const [x, y, z] of [[0, 0, 0], [0.02, 0, 0.02], [-0.02, 0, -0.02]]) await stroke(win, x, y, z);
  await clickRibbon(win, 'brush-toggle'); // Brush OFF
  await selectLast(win);
  await tab(win, 'modeling');
  await win.screenshot({ path: path.join(OUT, '02-blended-island.png'), fullPage: false });

  // ════ 4. SEA — broad turquoise plane; sits just above the island's
  //         flat (un-sculpted) base so the shoreline submerges and only
  //         the sculpted landmass + peak break the surface. ═══════════
  await addPrim(win, 'plane');
  await selectLast(win);
  await setXform(win, [0, 0.004, 0], [RAD, 0, 0], [16, 16, 16]);
  await setMat(win, '#15616b', 0);

  // ════ 5. MONUMENT — eroded stone obelisk on the island crown ═════
  await addPrim(win, 'cone');
  await selectLast(win);
  await setXform(win, [0, 0.03, 0], [0, 0, 0], [0.7, 2.4, 0.7]);
  await setMat(win, '#6f6457', 0);
  await tab(win, 'sculpting');
  await clickRibbon(win, 'sculpt-erode');
  await tab(win, 'modeling');

  // ════ 6. PALMS — two procedural trees rooted on the island ═══════
  for (const px of [0.045, -0.05]) {
    await setRange(win, '[data-studio-proc="depth"]', '4');
    await setRange(win, '[data-studio-proc="branches"]', '3');
    await clickAction(win, 'generate-tree');
    await selectLast(win);
    await setXform(win, [px, 0.012, px > 0 ? 0.03 : -0.04], [0, 0, 0], [1.0, 1.2, 1.0]);
    await setMat(win, '#3c5a32', 0);
  }

  // ════ 7. SHORE BOULDER — eroded rock at the waterline ════════════
  await addPrim(win, 'icosahedron');
  await selectLast(win);
  await setXform(win, [0.07, 0.0, 0.05], [0.3, 0.5, 0.1], [1.1, 0.8, 1.1]);
  await setMat(win, '#4d4a40', 0);
  await tab(win, 'sculpting');
  await clickRibbon(win, 'sculpt-erode');
  await tab(win, 'modeling');
  await win.screenshot({ path: path.join(OUT, '03-island-complete.png'), fullPage: false });

  // ════ 8. LIGHTING — tropical day; accent intensities only ════════
  const lc = (w, h) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="color"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, h);
  await tab(win, 'rendering');
  await lc(win, '#fff1d0'); await setRange(win, '[data-studio-lighting="intensity"]', '0.16'); await clickAction(win, 'add-light');
  await lc(win, '#86c5e0'); await setRange(win, '[data-studio-lighting="intensity"]', '0.1'); await clickAction(win, 'add-light');
  await lc(win, '#cfe8d0'); await setRange(win, '[data-studio-lighting="intensity"]', '0.08'); await clickAction(win, 'add-light');
  await expect(win.locator('[data-studio-light-count]')).toHaveText('3 added');

  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(380);
  await clickAction(win, 'capture-showreel');
  await expect.poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()), { timeout: 12000 }).toBeGreaterThanOrEqual(4);

  // ════ 9. POST — PostProcessVolume parity ═════════════════════════
  await tab(win, 'compositing');
  await clickRibbon(win, 'pp-ssao'); await clickRibbon(win, 'pp-tone-map'); await clickRibbon(win, 'pp-dof');
  await win.locator('[data-studio-compositing="filter"]').selectOption('saturate(2.5)');
  await clickAction(win, 'post-process');
  await win.waitForTimeout(300);

  // ════ Integrated assertions ══════════════════════════════════════
  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport; const kinds = new Set(); let prim = 0, lights = 0, stroked = 0, eroded = 0;
    const fx = (window.__archdiscScene.userData && window.__archdiscScene.userData.studioPostFx) || {};
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) { prim++; kinds.add(o.userData.archdiscStudioPrimitiveKind); if (o.userData.archdiscStudioBrushStroke > 0) stroked++; if (o.userData.archdiscStudioErode > 0) eroded++; }
      if (o.userData && o.userData.archdiscStudioLight) lights++;
    });
    return { prim, lights, stroked, eroded, kinds: Array.from(kinds).sort(), postFx: Object.keys(fx).sort() };
  });
  expect(state.prim).toBe(6); // island + sea + monument + 2 palms + boulder
  expect(state.lights).toBe(3);
  expect(state.stroked).toBeGreaterThanOrEqual(1);  // island carries real localized strokes
  expect(state.eroded).toBeGreaterThanOrEqual(2);   // monument + boulder (solid bodies degrade cleanly)
  expect(state.kinds).toEqual(['cone', 'icosahedron', 'plane', 'procedural-tree']);
  expect(state.postFx).toEqual(['depthOfField', 'ssao', 'toneMap']);

  // ════ Headline turntable ═════════════════════════════════════════
  await tab(win, 'rendering');
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(360);
  for (const az of [25, 115, 205, 295]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 14, 1.3), az);
    await win.waitForTimeout(290);
    await win.screenshot({ path: path.join(OUT, `04-turntable-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  sculpted island: ${state.prim} bodies, localized disp center=${disp.center.toFixed(3)} edge=${disp.edge.toFixed(3)} (ratio ${(disp.center / (disp.edge || 1e-6)).toFixed(1)}x), stroked=${state.stroked}`);

  await app.close();
});
