import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio integration — ERODED ROCK BADLANDS (Video-178 parity).
 *
 * Video-178 (Blender x Houdini) shows a craggy eroded rock landscape —
 * mesas / buttes / channels in clay-shaded stone. Built here ON A SOLID
 * SLAB (a box, not a plane) so the localized sculpt brush can raise mesas
 * and the erosion/weather degradation carves craggy rock instead of
 * shredding a zero-thickness sheet (the lesson from the island scene).
 *
 * Workflow: solid slab -> localized Draw/Crease strokes raise buttes +
 * cut channels (proven localized) -> Erode + Weather for craggy detail ->
 * scattered eroded boulders + a rock spire -> overcast rock lighting ->
 * Unreal PostProcessVolume (SSAO crevices + ACES). 7 bodies.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-rock-badlands');

async function tab(win, name) { const t = win.locator(`.workbench-ribbon-placeholder-tab[data-studio-discipline="${name}"]`); await t.scrollIntoViewIfNeeded(); await t.click(); await win.waitForTimeout(230); }
async function addPrim(win, kind) { await win.locator(`[data-studio-primitive="${kind}"]`).click(); await win.waitForTimeout(210); }
async function selectLast(win) {
  await win.evaluate(() => { const vp = window.__archdiscViewport; let best = null, bi = -1; vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { const m = /(\d+)$/.exec(o.name || ''); const i = m ? +m[1] : 0; if (i >= bi) { bi = i; best = o; } } }); if (best && window.__studioSelectMesh) window.__studioSelectMesh(best); });
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
async function setMat(win, hex) { await win.evaluate((h) => { const el = document.querySelector('[data-studio-material="color"]'); if (!el) return; const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, h); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, hex); await win.waitForTimeout(120); }
async function setRange(win, sel, val) { await win.evaluate(({ s, v }) => { const el = document.querySelector(s); if (!el) return; const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, { s: sel, v: val }); await win.waitForTimeout(90); }
async function clickAction(win, a) { const b = win.locator(`[data-studio-action="${a}"]`); await b.scrollIntoViewIfNeeded(); await b.click(); await win.waitForTimeout(190); }
async function clickRibbon(win, a) { const b = win.locator(`[data-studio-ribbon-action="${a}"]`); await b.scrollIntoViewIfNeeded(); await b.click(); await win.waitForTimeout(220); }
async function screenOf(win, wx, wy, wz) {
  return await win.evaluate(({ x, y, z }) => { const vp = window.__archdiscViewport; const cam = vp.camera; const c = vp.renderer.domElement; const r = c.getBoundingClientRect(); const v = cam.position.clone(); v.set(x, y, z); v.project(cam); return { x: r.x + (v.x * 0.5 + 0.5) * r.width, y: r.y + (-v.y * 0.5 + 0.5) * r.height }; }, { x: wx, y: wy, z: wz });
}
async function stroke(win, wx, wy, wz) { const s = await screenOf(win, wx, wy, wz); await win.mouse.click(s.x, s.y); await win.waitForTimeout(55); }
async function snapMesh(win) { await win.evaluate(() => { const m = window.__studioSelectedMesh(); const p = m && m.geometry && m.geometry.attributes.position; window.__bd = p ? Float32Array.from(p.array) : null; }); }
async function localStats(win) {
  return await win.evaluate(() => {
    const m = window.__studioSelectedMesh(); if (!m || !m.geometry) return { frac: 1, topo: true };
    const p = m.geometry.attributes.position; const snap = window.__bd;
    if (!snap || snap.length !== p.array.length) return { frac: 1, topo: true };
    m.geometry.computeBoundingSphere(); const R = m.geometry.boundingSphere.radius || 1; const thr = 0.012 * R;
    let moved = 0;
    for (let i = 0; i < p.count; i++) { const dx = p.array[i * 3] - snap[i * 3], dy = p.array[i * 3 + 1] - snap[i * 3 + 1], dz = p.array[i * 3 + 2] - snap[i * 3 + 2]; if (Math.sqrt(dx * dx + dy * dy + dz * dz) > thr) moved++; }
    return { frac: moved / p.count, topo: false };
  });
}

test('Studio Integration — Eroded Rock Badlands (localized sculpt on solid slab, Video-178 parity)', async () => {
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

  // ════ 1. SOLID SLAB — the badlands base (a box, has volume) ═══════
  await addPrim(win, 'cube');
  await selectLast(win);
  await setXform(win, [0, 0, 0], [0, 0, 0], [7, 0.8, 7]); // wide flat slab
  await setMat(win, '#6a6258');
  for (let i = 0; i < 4; i++) await clickAction(win, 'subdivide-selected');

  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(280);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(28, 42, 1.1));
  await win.waitForTimeout(240);
  await snapMesh(win);

  // ════ 2. LOCALIZED SCULPT — raise mesas / buttes on the slab top ══
  const topY = 0.012; // approx world height of the slab's top face
  await tab(win, 'sculpting');
  await clickRibbon(win, 'brush-toggle');
  await clickRibbon(win, 'brush-mode-draw');
  await setRange(win, '[data-studio-brush="radius"]', '0.005');
  await setRange(win, '[data-studio-brush="strength"]', '0.95');
  // A cluster of buttes of differing heights.
  const buttes = [[0, 0], [0.04, 0.03], [-0.045, 0.02], [0.03, -0.045], [-0.03, -0.03]];
  for (const [x, z] of buttes) { for (let k = 0; k < 4; k++) await stroke(win, x, topY, z); }
  // Crease channels carve clefts between the buttes.
  await clickRibbon(win, 'brush-mode-crease');
  await setRange(win, '[data-studio-brush="radius"]', '0.006');
  for (const [x, z] of [[0.02, 0.015], [-0.022, -0.01], [0.005, -0.03]]) { await stroke(win, x, topY, z); await stroke(win, x, topY, z); }

  await selectLast(win);
  const ls = await localStats(win);
  // LOCALIZED proof: strokes moved a MINORITY of verts (buttes), not the
  // whole slab — a global op would move nearly all of them.
  expect(ls.frac).toBeGreaterThan(0.02);
  expect(ls.frac).toBeLessThan(0.65);
  await clickRibbon(win, 'brush-toggle');
  await selectLast(win);
  await tab(win, 'modeling');
  await win.screenshot({ path: path.join(OUT, '01-sculpted-buttes.png'), fullPage: false });

  // ════ 3. DEGRADE — erode + weather the SOLID slab into craggy rock ═
  await tab(win, 'sculpting');
  await clickRibbon(win, 'sculpt-erode');
  await clickRibbon(win, 'sculpt-weather');
  await tab(win, 'modeling');
  await win.screenshot({ path: path.join(OUT, '02-eroded-badlands.png'), fullPage: false });

  // ════ 4. ROCK SPIRE — eroded cone landmark ═══════════════════════
  await addPrim(win, 'cone');
  await selectLast(win);
  await setXform(win, [0.0, 0.03, 0.0], [0, 0, 0], [1.1, 2.6, 1.1]);
  await setMat(win, '#746a5c');
  await tab(win, 'sculpting'); await clickRibbon(win, 'sculpt-erode'); await tab(win, 'modeling');

  // ════ 5. SCATTERED BOULDERS — three eroded icosahedra ════════════
  const rocks = [[0.075, 0.01, 0.05, 1.2], [-0.08, 0.008, -0.04, 0.95], [0.05, 0.006, -0.08, 1.1]];
  for (const [x, y, z, sc] of rocks) {
    await addPrim(win, 'icosahedron');
    await selectLast(win);
    await setXform(win, [x, y, z], [0.3, 0.6, 0.1], [sc, sc * 0.8, sc]);
    await setMat(win, '#5d564b');
    await tab(win, 'sculpting'); await clickRibbon(win, 'sculpt-erode'); await tab(win, 'modeling');
  }
  await win.screenshot({ path: path.join(OUT, '03-badlands-complete.png'), fullPage: false });

  // ════ 6. OVERCAST ROCK LIGHTING — neutral, accent intensities ════
  const lc = (w, h) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="color"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, h);
  await tab(win, 'rendering');
  await lc(win, '#e8e4dc'); await setRange(win, '[data-studio-lighting="intensity"]', '0.16'); await clickAction(win, 'add-light');
  await lc(win, '#aeb6c2'); await setRange(win, '[data-studio-lighting="intensity"]', '0.1'); await clickAction(win, 'add-light');
  await lc(win, '#c9a87a'); await setRange(win, '[data-studio-lighting="intensity"]', '0.08'); await clickAction(win, 'add-light');
  await expect(win.locator('[data-studio-light-count]')).toHaveText('3 added');

  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(360);
  await clickAction(win, 'capture-showreel');
  await expect.poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()), { timeout: 12000 }).toBeGreaterThanOrEqual(4);

  // ════ 7. POST — PostProcessVolume (SSAO deepens crevices) ════════
  await tab(win, 'compositing');
  await clickRibbon(win, 'pp-ssao'); await clickRibbon(win, 'pp-tone-map'); await clickRibbon(win, 'pp-dof');
  await win.locator('[data-studio-compositing="filter"]').selectOption('contrast(180%)');
  await clickAction(win, 'post-process');
  await win.waitForTimeout(300);

  // ════ Assertions ═════════════════════════════════════════════════
  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport; const kinds = new Set(); let prim = 0, lights = 0, stroked = 0, eroded = 0;
    const fx = (window.__archdiscScene.userData && window.__archdiscScene.userData.studioPostFx) || {};
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { prim++; kinds.add(o.userData.archdiscStudioPrimitiveKind); if (o.userData.archdiscStudioBrushStroke > 0) stroked++; if (o.userData.archdiscStudioErode > 0) eroded++; } if (o.userData && o.userData.archdiscStudioLight) lights++; });
    return { prim, lights, stroked, eroded, kinds: Array.from(kinds).sort(), postFx: Object.keys(fx).sort() };
  });
  expect(state.prim).toBe(5); // slab + spire + 3 boulders
  expect(state.lights).toBe(3);
  expect(state.stroked).toBeGreaterThanOrEqual(1); // slab carries localized strokes
  expect(state.eroded).toBeGreaterThanOrEqual(5);  // slab + spire + 3 boulders all degraded
  expect(state.kinds).toEqual(['cone', 'cube', 'icosahedron']);
  expect(state.postFx).toEqual(['depthOfField', 'ssao', 'toneMap']);

  // ════ Headline turntable ═════════════════════════════════════════
  await tab(win, 'rendering');
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(360);
  for (const az of [30, 120, 210, 300]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 20, 1.3), az);
    await win.waitForTimeout(290);
    await win.screenshot({ path: path.join(OUT, `04-turntable-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  rock badlands: ${state.prim} bodies, localized stroke frac=${ls.frac.toFixed(3)}, stroked=${state.stroked} eroded=${state.eroded}`);

  await app.close();
});
