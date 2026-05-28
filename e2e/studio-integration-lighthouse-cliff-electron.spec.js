import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio integration — LIGHTHOUSE ON A ROCKY CLIFF AT DUSK.
 *
 * A complex, coherent, recognizable environment composed entirely through
 * real UI gestures (no scene injection): spawn primitives, position/scale
 * each via the Selection transform inputs, sculpt the cliff, stack
 * modifiers on the tower, UV-project + texture, light the beacon, and run
 * an Unreal-style PostProcessVolume pass. Exercises slice 110/111 ops
 * (sculpt clay/scrape, mod-bevel/solidify, uv-cyl-proj, pp-ssao /
 * lens-flare / tone-map) as part of a real model — not a bare primitive.
 *
 * Parts: water, cliff, tower, gallery deck, lamp room (beacon), roof,
 * 3 shore rocks = 8 bodies, 3 lights, post-processed renders.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-lighthouse-cliff');

async function tab(win, name) {
  const t = win.locator(`.workbench-ribbon-placeholder-tab[data-studio-discipline="${name}"]`);
  await t.scrollIntoViewIfNeeded();
  await t.click();
  await win.waitForTimeout(260);
}

async function addPrim(win, kind) {
  await win.locator(`[data-studio-primitive="${kind}"]`).click();
  await win.waitForTimeout(240);
}

// Select the most-recently-spawned primitive (highest trailing index in name).
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
  await win.waitForTimeout(160);
}

// Drive the Selection transform inputs (metres / radians, raw values).
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
  await win.waitForTimeout(140);
}

async function setColor(win, hex) {
  await win.evaluate((h) => {
    const el = document.querySelector('[data-studio-material="color"]');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, h);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, hex);
  await win.waitForTimeout(140);
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
  await win.waitForTimeout(120);
}

async function clickAction(win, action) {
  const b = win.locator(`[data-studio-action="${action}"]`);
  await b.scrollIntoViewIfNeeded();
  await b.click();
  await win.waitForTimeout(220);
}

async function clickRibbon(win, action) {
  const b = win.locator(`[data-studio-ribbon-action="${action}"]`);
  await b.scrollIntoViewIfNeeded();
  await b.click();
  await win.waitForTimeout(260);
}

// Snapshot the selected mesh's vertex positions for later comparison.
async function snapMesh(win) {
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
    const p = m && m.geometry && m.geometry.attributes.position;
    window.__studioSnap = p ? Float32Array.from(p.array) : null;
  });
}

// Measure how much the selected mesh deformed since the last snapMesh:
// either the topology grew (auto-subdivide) or the vertices moved (RMS
// displacement, normalized by bounding-sphere radius). Proof that a
// sculpt op genuinely reshapes geometry, not just bumps a counter.
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

test('Studio Integration — Lighthouse on a Rocky Cliff (multi-discipline complex model)', async () => {
  test.setTimeout(420000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 70,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await tab(win, 'modeling');

  // ════ 1. SEA — broad plane, deep dusk-blue, just below the cliff ════
  await addPrim(win, 'plane');
  await selectLast(win);
  await setXform(win, [0, -0.03, 0], [0, 0, 0], [6, 1, 6]);
  await setColor(win, '#10243a');

  // ════ 2. CLIFF — tall voxel headland eroded into weathered rock ════
  await addPrim(win, 'voxel-cube');
  await selectLast(win);
  await setXform(win, [0, -0.02, 0], [0, 0, 0], [3.6, 2.0, 3.6]);
  await setColor(win, '#5b5048');
  // Snapshot vertices BEFORE sculpting so we can prove the Erode/Weather
  // ops genuinely deform the mesh (not just bump a counter).
  await snapMesh(win);
  await tab(win, 'sculpting');
  await clickRibbon(win, 'sculpt-erode');   // ridged-multifractal rock carve (auto-subdivides)
  await clickRibbon(win, 'sculpt-weather'); // pitting / material loss
  const cliffDef = await deformMetric(win);
  // Real deformation: either the topology grew (auto-subdivide) or the
  // vertices moved by a meaningful fraction (>3%) of the cliff's radius.
  expect(cliffDef.grew || cliffDef.rms > 0.03).toBeTruthy();
  await tab(win, 'modeling');
  await win.screenshot({ path: path.join(OUT, '01-sea-and-cliff.png'), fullPage: false });

  // ════ 3. TOWER — tall tapered cylinder, beveled + solidified shell ══
  await addPrim(win, 'cylinder');
  await selectLast(win);
  await setXform(win, [0, 0.046, 0], [0, 0, 0], [1.0, 2.4, 1.0]);
  await setColor(win, '#e8e4dc');
  await clickRibbon(win, 'mod-bevel');
  await clickRibbon(win, 'mod-solidify');
  // Striped paint band via cylindrical UV projection + procedural texture.
  await tab(win, 'uv-texture');
  await clickRibbon(win, 'uv-cyl-proj');
  await tab(win, 'modeling');
  await win.screenshot({ path: path.join(OUT, '02-tower.png'), fullPage: false });

  // ════ 4. GALLERY DECK — torus ring near the top, solidified ════════
  await addPrim(win, 'torus');
  await selectLast(win);
  await setXform(win, [0, 0.082, 0], [0, 0, 0], [1.4, 0.5, 1.4]);
  await setColor(win, '#3a3530');
  await clickRibbon(win, 'mod-solidify');

  // ════ 5. LAMP ROOM — short glowing cylinder (the beacon) ═══════════
  await addPrim(win, 'cylinder');
  await selectLast(win);
  await setXform(win, [0, 0.092, 0], [0, 0, 0], [0.85, 0.6, 0.85]);
  await setColor(win, '#ffe39a');
  await setRange(win, '[data-studio-material="emissive"]', '1.1');

  // ════ 6. ROOF — red cone cap ═══════════════════════════════════════
  await addPrim(win, 'cone');
  await selectLast(win);
  await setXform(win, [0, 0.114, 0], [0, 0, 0], [1.1, 1.0, 1.1]);
  await setColor(win, '#7c2b22');
  await win.screenshot({ path: path.join(OUT, '03-lighthouse-built.png'), fullPage: false });

  // ════ 7. SHORE ROCKS — three icosahedra, decimated, scattered ══════
  const rocks = [
    { p: [0.058, 0.004, 0.040], s: [1.3, 1.0, 1.3] },
    { p: [-0.052, 0.002, 0.052], s: [1.0, 0.8, 1.0] },
    { p: [0.030, 0.006, -0.058], s: [1.15, 0.9, 1.15] },
  ];
  for (const r of rocks) {
    await addPrim(win, 'icosahedron');
    await selectLast(win);
    await setXform(win, r.p, [0.3, 0.7, 0.1], r.s);
    await setColor(win, '#4a463f');
    // Erode each boulder into a believable weathered rock.
    await tab(win, 'sculpting');
    await clickRibbon(win, 'sculpt-erode');
    await tab(win, 'modeling');
  }
  await win.screenshot({ path: path.join(OUT, '04-rocks-added.png'), fullPage: false });

  // ════ 8. LIGHTING — warm beacon key, cool dusk fill, amber rim ═════
  // Restrained intensities — the scene already carries an emissive beacon
  // and ACES tone mapping; over-bright point lights blow the model out.
  const setLightColor = (win2, hex) => win2.evaluate((h) => {
    const el = document.querySelector('[data-studio-lighting="color"]');
    if (el) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, h); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  }, hex);
  await tab(win, 'rendering');
  await setLightColor(win, '#ffce7a');
  await setRange(win, '[data-studio-lighting="intensity"]', '0.75');
  await clickAction(win, 'add-light');
  await setLightColor(win, '#5a7fb5');
  await setRange(win, '[data-studio-lighting="intensity"]', '0.45');
  await clickAction(win, 'add-light');
  await setLightColor(win, '#d98a4a');
  await setRange(win, '[data-studio-lighting="intensity"]', '0.35');
  await clickAction(win, 'add-light');
  await expect(win.locator('[data-studio-light-count]')).toHaveText('3 added');

  // ════ 9. FRAME + SHOWREEL ══════════════════════════════════════════
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);
  await clickAction(win, 'capture-showreel');
  await expect
    .poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()), { timeout: 12000 })
    .toBeGreaterThanOrEqual(4);

  // ════ 10. POST-PROCESS — Unreal PostProcessVolume parity pass ══════
  await tab(win, 'compositing');
  await clickRibbon(win, 'pp-ssao');
  await clickRibbon(win, 'pp-tone-map');
  await clickRibbon(win, 'pp-lens-flare');
  await win.locator('[data-studio-compositing="filter"]').selectOption('contrast(180%)');
  await clickAction(win, 'post-process');
  await win.waitForTimeout(300);

  // ════ Integrated assertions ════════════════════════════════════════
  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const kinds = new Set();
    let prim = 0, lights = 0, emissive = 0, eroded = 0;
    const fx = (window.__archdiscScene.userData && window.__archdiscScene.userData.studioPostFx) || {};
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        prim++; kinds.add(o.userData.archdiscStudioPrimitiveKind);
        if (o.material && o.material.emissiveIntensity > 0.5) emissive++;
        if (o.userData.archdiscStudioErode > 0) eroded++;
      }
      if (o.userData && o.userData.archdiscStudioLight) lights++;
    });
    return {
      prim, lights, emissive, eroded,
      kinds: Array.from(kinds).sort(),
      postFx: Object.keys(fx).sort(),
    };
  });
  expect(state.prim).toBe(9); // sea + cliff + tower + gallery + lamp + roof + 3 rocks
  expect(state.lights).toBe(3);
  expect(state.emissive).toBeGreaterThanOrEqual(1); // beacon glows
  expect(state.kinds).toEqual(['cone', 'cylinder', 'icosahedron', 'plane', 'torus', 'voxel-cube']);
  expect(state.postFx).toEqual(['lensFlare', 'ssao', 'toneMap']);
  expect(state.eroded).toBeGreaterThanOrEqual(4); // cliff + 3 rocks carry erosion

  // ════ Headline turntable — one good framing per angle ══════════════
  await tab(win, 'rendering');
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);
  for (const az of [35, 125, 215, 305]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 16, 1.35), az);
    await win.waitForTimeout(300);
    await win.screenshot({ path: path.join(OUT, `05-turntable-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  lighthouse cliff: ${state.prim} bodies + ${state.lights} lights + postFX [${state.postFx.join(', ')}]`);

  await app.close();
});
