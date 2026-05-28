import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio integration — SCULPTURAL ORGANIC POD (Video-985 parity) +
 * proof of the new Sculpt Brush X-SYMMETRY tool.
 *
 * An organic symmetric pod is sculpted from an icosahedron using the
 * localized brush with SYMMETRY X enabled: every stroke is painted only
 * on the +X side, yet the mirror produces a bilaterally even form. The
 * test proves it numerically — left-half and right-half displacement are
 * balanced (a one-sided sculpt without symmetry would be ~100% lopsided).
 *
 * "Both, depth first": symmetry is the highest-leverage sculpt tool for
 * organic / character work, integrated before continuing breadth targets.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-sculptural-pod');

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
async function setMat(win, hex, emissive) { await win.evaluate(({ h, e }) => { const setV = (sel, v) => { const el = document.querySelector(sel); if (!el) return; const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }; setV('[data-studio-material="color"]', h); if (e != null) setV('[data-studio-material="emissive"]', e); }, { h: hex, e: emissive }); await win.waitForTimeout(120); }
async function setRange(win, sel, val) { await win.evaluate(({ s, v }) => { const el = document.querySelector(s); if (!el) return; const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, { s: sel, v: val }); await win.waitForTimeout(90); }
async function clickAction(win, a) { const b = win.locator(`[data-studio-action="${a}"]`); await b.scrollIntoViewIfNeeded(); await b.click(); await win.waitForTimeout(190); }
async function clickRibbon(win, a) { const b = win.locator(`[data-studio-ribbon-action="${a}"]`); await b.scrollIntoViewIfNeeded(); await b.click(); await win.waitForTimeout(220); }
async function screenOf(win, wx, wy, wz) { return await win.evaluate(({ x, y, z }) => { const vp = window.__archdiscViewport; const cam = vp.camera; const c = vp.renderer.domElement; const r = c.getBoundingClientRect(); const v = cam.position.clone(); v.set(x, y, z); v.project(cam); return { x: r.x + (v.x * 0.5 + 0.5) * r.width, y: r.y + (-v.y * 0.5 + 0.5) * r.height }; }, { x: wx, y: wy, z: wz }); }
async function stroke(win, wx, wy, wz) { const s = await screenOf(win, wx, wy, wz); await win.mouse.click(s.x, s.y); await win.waitForTimeout(55); }
async function snapMesh(win) { await win.evaluate(() => { const m = window.__studioSelectedMesh(); const p = m && m.geometry && m.geometry.attributes.position; window.__pod = p ? Float32Array.from(p.array) : null; }); }
async function symBalance(win) {
  return await win.evaluate(() => {
    const m = window.__studioSelectedMesh(); if (!m || !m.geometry) return { L: 0, R: 0, bal: 1 };
    const p = m.geometry.attributes.position; const snap = window.__pod;
    if (!snap || snap.length !== p.array.length) return { L: 0, R: 0, bal: 1 };
    let L = 0, R = 0;
    for (let i = 0; i < p.count; i++) {
      const ox = snap[i * 3];
      const dx = p.array[i * 3] - snap[i * 3], dy = p.array[i * 3 + 1] - snap[i * 3 + 1], dz = p.array[i * 3 + 2] - snap[i * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (ox > 1e-5) R += d; else if (ox < -1e-5) L += d;
    }
    return { L, R, bal: Math.abs(R - L) / ((R + L) || 1) };
  });
}

test('Studio Integration — Sculptural Pod (Sculpt X-symmetry, Video-985 parity)', async () => {
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

  // ════ 1. GROUND + PEDESTAL ═══════════════════════════════════════
  await addPrim(win, 'cube');
  await selectLast(win);
  await setXform(win, [0, -0.04, 0], [0, 0, 0], [5, 0.4, 5]);
  await setMat(win, '#14161c', 0);
  await addPrim(win, 'cylinder');
  await selectLast(win);
  await setXform(win, [0, -0.026, 0], [0, 0, 0], [1.2, 0.7, 1.2]);
  await setMat(win, '#2b2f38', 0);

  // ════ 2. HERO POD — icosa sculpted SYMMETRICALLY (strokes +X only) ═
  await addPrim(win, 'icosahedron');
  await selectLast(win);
  await setXform(win, [0, 0.012, 0], [0, 0, 0], [1.3, 1.85, 1.05]);
  await setMat(win, '#3a8f86', 0.5); // glowing organic membrane
  for (let i = 0; i < 3; i++) await clickAction(win, 'subdivide-selected');

  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(260);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(18, 14, 1.0));
  await win.waitForTimeout(240);
  await snapMesh(win);

  await tab(win, 'sculpting');
  await clickRibbon(win, 'brush-toggle');
  await clickRibbon(win, 'brush-symmetry-x'); // mirror every stroke across local X
  await setRange(win, '[data-studio-brush="radius"]', '0.005');
  await setRange(win, '[data-studio-brush="strength"]', '0.9');
  // All strokes on the +X side ONLY — symmetry must mirror them to -X.
  await clickRibbon(win, 'brush-mode-draw');
  for (const [y, z] of [[0.028, 0.012], [0.008, 0.015], [-0.012, 0.013]]) await stroke(win, 0.013, y, z);
  await clickRibbon(win, 'brush-mode-crease');
  await setRange(win, '[data-studio-brush="radius"]', '0.006');
  for (const [y, z] of [[0.018, 0.014], [-0.002, 0.014]]) await stroke(win, 0.02, y, z);
  await clickRibbon(win, 'brush-mode-inflate');
  await stroke(win, 0.016, 0.0, 0.013);

  await selectLast(win);
  const sym = await symBalance(win);
  // PROOF of symmetry: strokes were +X only, yet both halves moved by a
  // balanced amount (mirror worked). A non-symmetric sculpt would put
  // nearly all displacement on one side (bal -> 1).
  expect(sym.R).toBeGreaterThan(0);
  expect(sym.L).toBeGreaterThan(0);
  expect(sym.bal).toBeLessThan(0.3);
  await clickRibbon(win, 'brush-mode-smooth');
  await setRange(win, '[data-studio-brush="radius"]', '0.008');
  for (const [y, z] of [[0.015, 0.013], [-0.005, 0.013]]) await stroke(win, 0.012, y, z);
  await clickRibbon(win, 'brush-symmetry-x'); // off
  await clickRibbon(win, 'brush-toggle'); // off
  await selectLast(win);
  await tab(win, 'modeling');
  await win.screenshot({ path: path.join(OUT, '01-symmetric-pod.png'), fullPage: false });

  // ════ 3. TWO SMALLER PODS flanking the hero ══════════════════════
  for (const x of [0.06, -0.06]) {
    await addPrim(win, 'icosahedron');
    await selectLast(win);
    await setXform(win, [x, -0.006, 0.01], [0.2, 0.4, 0], [0.7, 1.0, 0.6]);
    await setMat(win, '#2f7d99', 0.4);
    await tab(win, 'sculpting'); await clickRibbon(win, 'sculpt-weather'); await tab(win, 'modeling');
  }
  await win.screenshot({ path: path.join(OUT, '02-pod-cluster.png'), fullPage: false });

  // ════ 4. LIGHTING — dim cool; the pods self-glow ════════════════
  const lc = (w, h) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="color"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, h);
  await tab(win, 'rendering');
  await lc(win, '#2f4a6a'); await setRange(win, '[data-studio-lighting="intensity"]', '0.13'); await clickAction(win, 'add-light');
  await lc(win, '#2a6a72'); await setRange(win, '[data-studio-lighting="intensity"]', '0.1'); await clickAction(win, 'add-light');
  await lc(win, '#5a4f8a'); await setRange(win, '[data-studio-lighting="intensity"]', '0.08'); await clickAction(win, 'add-light');
  await expect(win.locator('[data-studio-light-count]')).toHaveText('3 added');

  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(360);
  await clickAction(win, 'capture-showreel');
  await expect.poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()), { timeout: 12000 }).toBeGreaterThanOrEqual(4);

  // ════ 5. POST — bloom the bioluminescence ═══════════════════════
  await tab(win, 'compositing');
  await clickRibbon(win, 'pp-ssao'); await clickRibbon(win, 'pp-tone-map'); await clickRibbon(win, 'pp-lens-flare');
  await win.locator('[data-studio-compositing="filter"]').selectOption('saturate(2.5)');
  await clickAction(win, 'post-process');
  await win.waitForTimeout(300);

  // ════ Assertions ════════════════════════════════════════════════
  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport; const kinds = new Set(); let prim = 0, lights = 0, glowing = 0, stroked = 0;
    const fx = (window.__archdiscScene.userData && window.__archdiscScene.userData.studioPostFx) || {};
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { prim++; kinds.add(o.userData.archdiscStudioPrimitiveKind); if (o.material && o.material.emissiveIntensity > 0.3) glowing++; if (o.userData.archdiscStudioBrushStroke > 0) stroked++; } if (o.userData && o.userData.archdiscStudioLight) lights++; });
    return { prim, lights, glowing, stroked, kinds: Array.from(kinds).sort(), postFx: Object.keys(fx).sort() };
  });
  expect(state.prim).toBe(5); // ground + pedestal + hero pod + 2 small pods
  expect(state.lights).toBe(3);
  expect(state.glowing).toBeGreaterThanOrEqual(3); // hero + 2 small pods glow
  expect(state.stroked).toBeGreaterThanOrEqual(1); // hero carries symmetric strokes
  expect(state.kinds).toEqual(['cube', 'cylinder', 'icosahedron']);
  expect(state.postFx).toEqual(['lensFlare', 'ssao', 'toneMap']);

  // ════ Headline turntable ════════════════════════════════════════
  await tab(win, 'rendering');
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(360);
  for (const az of [20, 110, 200, 290]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 12, 1.2), az);
    await win.waitForTimeout(290);
    await win.screenshot({ path: path.join(OUT, `03-turntable-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  sculptural pod: ${state.prim} bodies, symmetry L=${sym.L.toFixed(3)} R=${sym.R.toFixed(3)} balance=${sym.bal.toFixed(3)} (0=perfect mirror)`);

  await app.close();
});
