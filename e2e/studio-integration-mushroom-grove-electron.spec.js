import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio integration — BIOLUMINESCENT MUSHROOM GROVE (night).
 *
 * An ORGANIC sculpting showcase: the mushroom caps are spheres reshaped
 * into believable fleshy fungal forms with the sculpt suite (clay deposit
 * + inflate + additive layer + a smoothing polish), then lit from within
 * (emissive) so they glow. Global brushes suit organic blobby forms far
 * better than hard primitives. Around them: a weathered mossy floor, a
 * fallen weathered log, and an eroded rock = 11 bodies, cool moonlight +
 * the caps' own bioluminescence, an Unreal PostProcessVolume bloom pass.
 *
 * Satisfies: complex model (not primitives) + full organic sculpting +
 * degradation + strict omni-coherence (verified by reading screenshots).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-mushroom-grove');

async function tab(win, name) {
  const t = win.locator(`.workbench-ribbon-placeholder-tab[data-studio-discipline="${name}"]`);
  await t.scrollIntoViewIfNeeded();
  await t.click();
  await win.waitForTimeout(240);
}
async function addPrim(win, kind) {
  await win.locator(`[data-studio-primitive="${kind}"]`).click();
  await win.waitForTimeout(220);
}
async function selectLast(win) {
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let best = null, bestIdx = -1;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        const mm = /(\d+)$/.exec(o.name || '');
        const idx = mm ? Number(mm[1]) : 0;
        if (idx >= bestIdx) { bestIdx = idx; best = o; }
      }
    });
    if (best && window.__studioSelectMesh) window.__studioSelectMesh(best);
  });
  await win.waitForTimeout(150);
}
async function setXform(win, pos, rot, scl) {
  await win.evaluate(({ p, r, s }) => {
    const set = (sel, v) => {
      if (v == null) return;
      const el = document.querySelector(sel);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    if (p) { set('[data-studio-selection-edit="position-x"]', p[0]); set('[data-studio-selection-edit="position-y"]', p[1]); set('[data-studio-selection-edit="position-z"]', p[2]); }
    if (r) { set('[data-studio-selection-edit="rotation-x"]', r[0]); set('[data-studio-selection-edit="rotation-y"]', r[1]); set('[data-studio-selection-edit="rotation-z"]', r[2]); }
    if (s) { set('[data-studio-selection-edit="scale-x"]', s[0]); set('[data-studio-selection-edit="scale-y"]', s[1]); set('[data-studio-selection-edit="scale-z"]', s[2]); }
  }, { p: pos, r: rot, s: scl });
  await win.waitForTimeout(130);
}
async function setMat(win, hex, emissive) {
  await win.evaluate(({ h, e }) => {
    const setV = (sel, v) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setV('[data-studio-material="color"]', h);
    if (e != null) setV('[data-studio-material="emissive"]', e);
  }, { h: hex, e: emissive });
  await win.waitForTimeout(130);
}
async function setRange(win, sel, val) {
  await win.evaluate(({ s, v }) => {
    const el = document.querySelector(s);
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { s: sel, v: val });
  await win.waitForTimeout(110);
}
async function clickAction(win, action) {
  const b = win.locator(`[data-studio-action="${action}"]`);
  await b.scrollIntoViewIfNeeded();
  await b.click();
  await win.waitForTimeout(200);
}
async function clickRibbon(win, action) {
  const b = win.locator(`[data-studio-ribbon-action="${action}"]`);
  await b.scrollIntoViewIfNeeded();
  await b.click();
  await win.waitForTimeout(240);
}
async function snapMesh(win) {
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
    const p = m && m.geometry && m.geometry.attributes.position;
    window.__studioSnap = p ? Float32Array.from(p.array) : null;
  });
}
async function deformMetric(win) {
  return await win.evaluate(() => {
    const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
    const p = m && m.geometry && m.geometry.attributes.position;
    const snap = window.__studioSnap;
    if (!p) return { count: 0, grew: false, rms: 0 };
    if (!snap || snap.length !== p.array.length) return { count: p.count, grew: true, rms: 0 };
    let sum = 0;
    for (let i = 0; i < p.array.length; i++) { const d = p.array[i] - snap[i]; sum += d * d; }
    m.geometry.computeBoundingSphere();
    const r = (m.geometry.boundingSphere && m.geometry.boundingSphere.radius) || 1;
    return { count: p.count, grew: false, rms: Math.sqrt(sum / p.count) / (r || 1) };
  });
}

// Build one mushroom: plain stem + an organically-sculpted glowing cap.
// Returns the cap's deformation metric so the test can assert real sculpt.
async function mushroom(win, base, stemH, capScale, capHex) {
  // Stem.
  await addPrim(win, 'cylinder');
  await selectLast(win);
  await setXform(win, [base[0], base[1] + stemH * 0.015, base[2]], [0, 0, 0], [0.42, stemH, 0.42]);
  await setMat(win, '#d8cdb6', 0);
  // Cap — sphere flattened into a dome, then sculpted organic + lit.
  await addPrim(win, 'sphere');
  await selectLast(win);
  const capY = base[1] + stemH * 0.03 + 0.004;
  await setXform(win, [base[0], capY, base[2]], [0, 0, 0], capScale);
  await setMat(win, capHex, 1.4);
  await clickAction(win, 'subdivide-selected');
  await snapMesh(win);
  await tab(win, 'sculpting');
  await clickRibbon(win, 'sculpt-clay');   // fleshy deposits
  await clickRibbon(win, 'sculpt-layer');  // additive cap thickness
  await clickRibbon(win, 'sculpt-polish'); // soften into organic dome
  const def = await deformMetric(win);
  await tab(win, 'modeling');
  return def;
}

test('Studio Integration — Bioluminescent Mushroom Grove (organic sculpt suite)', async () => {
  test.setTimeout(480000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 60,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await tab(win, 'modeling');

  // ════ 1. FOREST FLOOR — mossy, weathered into uneven ground ═══════
  await addPrim(win, 'plane');
  await selectLast(win);
  await setXform(win, [0, -0.024, 0], [0, 0, 0], [5, 1, 5]);
  await setMat(win, '#23301d', 0);
  await clickAction(win, 'subdivide-selected');
  await tab(win, 'sculpting');
  await clickRibbon(win, 'sculpt-weather'); // uneven mossy hummocks
  await tab(win, 'modeling');

  // ════ 2-4. THREE GLOWING MUSHROOMS (sculpted organic caps) ════════
  const m1 = await mushroom(win, [0, 0.0, 0],            2.0, [1.8, 0.95, 1.8], '#3fd6c4'); // teal
  const m2 = await mushroom(win, [0.062, 0.004, 0.034],  1.3, [1.25, 0.8, 1.25], '#8a6cff'); // violet
  const m3 = await mushroom(win, [-0.056, -0.002, -0.02], 2.4, [2.0, 1.0, 2.0],  '#48b6ff'); // blue
  // At least one cap proven to really deform under the brushes.
  expect(m1.grew || m1.rms > 0.03).toBeTruthy();
  expect(m3.grew || m3.rms > 0.03).toBeTruthy();
  await win.screenshot({ path: path.join(OUT, '01-three-mushrooms.png'), fullPage: false });

  // ════ 5. FALLEN LOG — horizontal weathered cylinder ══════════════
  await addPrim(win, 'cylinder');
  await selectLast(win);
  await setXform(win, [0.04, -0.014, 0.07], [0, 0, 1.5708], [0.7, 3.0, 0.7]);
  await setMat(win, '#4a3a2a', 0);
  await tab(win, 'sculpting');
  await clickRibbon(win, 'sculpt-weather'); // bark rot
  await tab(win, 'modeling');

  // ════ 6. MOSSY BOULDER — eroded rock ═════════════════════════════
  await addPrim(win, 'icosahedron');
  await selectLast(win);
  await setXform(win, [-0.085, -0.004, 0.05], [0.3, 0.5, 0.1], [1.3, 0.95, 1.3]);
  await setMat(win, '#2f3a28', 0);
  await tab(win, 'sculpting');
  await clickRibbon(win, 'sculpt-erode');
  await tab(win, 'modeling');

  // ════ 7. TWO TINY SPROUT MUSHROOMS (cap + stem) ══════════════════
  await addPrim(win, 'cylinder');
  await selectLast(win);
  await setXform(win, [-0.018, -0.012, 0.052], [0, 0, 0], [0.22, 0.7, 0.22]);
  await setMat(win, '#d8cdb6', 0);
  await addPrim(win, 'sphere');
  await selectLast(win);
  await setXform(win, [-0.018, -0.001, 0.052], [0, 0, 0], [0.55, 0.4, 0.55]);
  await setMat(win, '#ffae5c', 1.2); // warm sprout glow
  await win.screenshot({ path: path.join(OUT, '02-grove-complete.png'), fullPage: false });

  // ════ 8. NIGHT LIGHTING — faint cool moonlight; caps self-light ═══
  const setLightColor = (w, hex) => w.evaluate((h) => {
    const el = document.querySelector('[data-studio-lighting="color"]');
    if (el) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, h); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  }, hex);
  await tab(win, 'rendering');
  // Accent intensities only — the point lights sit ~0.066 m away with
  // inverse-square decay, so the emissive caps + default rig do the work.
  await setLightColor(win, '#3a4f7a');
  await setRange(win, '[data-studio-lighting="intensity"]', '0.14');
  await clickAction(win, 'add-light');
  await setLightColor(win, '#2f6a78');
  await setRange(win, '[data-studio-lighting="intensity"]', '0.1');
  await clickAction(win, 'add-light');
  await setLightColor(win, '#6a4f8a');
  await setRange(win, '[data-studio-lighting="intensity"]', '0.08');
  await clickAction(win, 'add-light');
  await expect(win.locator('[data-studio-light-count]')).toHaveText('3 added');

  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);
  await clickAction(win, 'capture-showreel');
  await expect
    .poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()), { timeout: 12000 })
    .toBeGreaterThanOrEqual(4);

  // ════ 9. POST — bloom-style PostProcessVolume to bloom the glow ═══
  await tab(win, 'compositing');
  await clickRibbon(win, 'pp-ssao');
  await clickRibbon(win, 'pp-tone-map');
  await clickRibbon(win, 'pp-lens-flare'); // halo the bioluminescence
  await win.locator('[data-studio-compositing="filter"]').selectOption('saturate(2.5)');
  await clickAction(win, 'post-process');
  await win.waitForTimeout(300);

  // ════ Integrated assertions ═══════════════════════════════════════
  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const kinds = new Set();
    let prim = 0, lights = 0, glowing = 0, sculpted = 0;
    const fx = (window.__archdiscScene.userData && window.__archdiscScene.userData.studioPostFx) || {};
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        prim++; kinds.add(o.userData.archdiscStudioPrimitiveKind);
        if (o.material && o.material.emissiveIntensity > 0.5) glowing++;
        if (o.userData.archdiscStudioBrushClay > 0 || o.userData.archdiscStudioErode > 0 || o.userData.archdiscStudioWeather > 0) sculpted++;
      }
      if (o.userData && o.userData.archdiscStudioLight) lights++;
    });
    return { prim, lights, glowing, sculpted, kinds: Array.from(kinds).sort(), postFx: Object.keys(fx).sort() };
  });
  expect(state.prim).toBe(11); // floor + 3 stems + 3 caps + log + boulder + sprout stem + sprout cap
  expect(state.lights).toBe(3);
  expect(state.glowing).toBeGreaterThanOrEqual(4);  // 3 big caps + sprout cap
  expect(state.sculpted).toBeGreaterThanOrEqual(6); // floor + 3 caps + log + boulder
  expect(state.kinds).toEqual(['cylinder', 'icosahedron', 'plane', 'sphere']);
  expect(state.postFx).toEqual(['lensFlare', 'ssao', 'toneMap']);

  // ════ Headline turntable — whole grove framed per angle ═══════════
  await tab(win, 'rendering');
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(380);
  for (const az of [40, 130, 220, 310]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 16, 1.3), az);
    await win.waitForTimeout(300);
    await win.screenshot({ path: path.join(OUT, `03-turntable-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  mushroom grove: ${state.prim} bodies, glowing=${state.glowing}, sculpted=${state.sculpted}, caps RMS m1=${m1.rms.toFixed(3)} m3=${m3.rms.toFixed(3)}`);

  await app.close();
});
