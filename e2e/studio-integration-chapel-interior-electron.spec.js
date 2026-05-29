import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio integration — GOTHIC CHAPEL INTERIOR (capstone).
 *
 * Assembles the full gothic kit built across slices 119/130/132/133 into a
 * complete nave interior: a stone floor, two rows of nave piers with
 * capitals, a pointed OGEE arcade, clerestory ARCH windows, a rib vault
 * overhead (transverse ARCH ribs + crossing OGEE diagonals + bosses), a
 * tracery east window over the altar, and the altar itself. ~55 bodies,
 * deterministic, built through the fast placeBody path. Verified by
 * multi-angle captures including the hero shot down the nave.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-chapel-interior');
const PI = Math.PI;
const STONE = '#bdb8ae', STONE2 = '#a9a399', STONE3 = '#c9c3b8', DARK = '#4a4640', GLASS = '#7fa0c8';

let _ready = false;

async function tab(win, name) { const t = win.locator(`.workbench-ribbon-placeholder-tab[data-studio-discipline="${name}"]`); await t.scrollIntoViewIfNeeded(); await t.click(); await win.waitForTimeout(200); }
async function placeBody(win, kind, pos, scl, hex, rot) {
  const before = await win.evaluate(() => { let n = 0; window.__archdiscViewport.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; }); return n; });
  await win.locator(`[data-studio-primitive="${kind}"]`).click();
  await win.waitForFunction((n) => { let c = 0; window.__archdiscViewport.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) c++; }); return c > n; }, before, { timeout: 5000 });
  const arg = { p: pos, s: scl, h: hex, r: rot || [0, 0, 0] };
  if (!_ready) {
    await win.evaluate(() => { const vp = window.__archdiscViewport; let best = null, bi = -1; vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { const m = /(\d+)$/.exec(o.name || ''); const i = m ? +m[1] : 0; if (i >= bi) { bi = i; best = o; } } }); if (best && window.__studioSelectMesh) window.__studioSelectMesh(best); });
    await win.waitForSelector('[data-studio-selection-edit="position-x"]', { timeout: 5000 });
    _ready = true;
  }
  await win.evaluate(({ a }) => {
    const vp = window.__archdiscViewport; let best = null, bi = -1;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { const m = /(\d+)$/.exec(o.name || ''); const i = m ? +m[1] : 0; if (i >= bi) { bi = i; best = o; } } });
    if (best && window.__studioSelectMesh) window.__studioSelectMesh(best);
    const set = (sel, v) => { const el = document.querySelector(sel); if (!el) return; const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('[data-studio-selection-edit="position-x"]', a.p[0]); set('[data-studio-selection-edit="position-y"]', a.p[1]); set('[data-studio-selection-edit="position-z"]', a.p[2]);
    set('[data-studio-selection-edit="rotation-x"]', a.r[0]); set('[data-studio-selection-edit="rotation-y"]', a.r[1]); set('[data-studio-selection-edit="rotation-z"]', a.r[2]);
    set('[data-studio-selection-edit="scale-x"]', a.s[0]); set('[data-studio-selection-edit="scale-y"]', a.s[1]); set('[data-studio-selection-edit="scale-z"]', a.s[2]);
    if (a.h) set('[data-studio-material="color"]', a.h);
  }, { a: arg });
}

test('Studio Integration — Gothic Chapel Interior (capstone)', async () => {
  test.setTimeout(720000);
  fs.mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 4 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);
  await tab(win, 'modeling');

  // Nave runs along Z; altar/east window at -Z; width along X. Springing
  // line y=0, crown ~y+0.05, floor y=-0.06. Columns at x=+/-0.042.
  const HX = 0.042;
  const colZ = [-0.06, -0.02, 0.02, 0.06];

  // ════ FLOOR + side aisle plinths ═════════════════════════════════
  await placeBody(win, 'cube', [0, -0.062, 0], [3.6, 0.2, 6.6], STONE2);

  // ════ NAVE PIERS + capitals (two rows) ══════════════════════════
  for (const sx of [-HX, HX]) {
    for (const z of colZ) {
      await placeBody(win, 'cylinder', [sx, -0.018, z], [0.5, 2.6, 0.5], STONE);            // pier
      await placeBody(win, 'cube', [sx, 0.018, z], [0.62, 0.22, 0.62], STONE3);             // capital
    }
  }
  await win.screenshot({ path: path.join(OUT, '01-colonnade.png'), fullPage: false });

  // ════ OGEE ARCADE — pointed arches between piers, each side ══════
  for (const sx of [-HX, HX]) {
    for (let i = 0; i < colZ.length - 1; i++) {
      const z = (colZ[i] + colZ[i + 1]) / 2;
      await placeBody(win, 'ogee', [sx, 0.026, z], [1.55, 1.2, 0.5], STONE2, [0, PI / 2, 0]);
    }
  }

  // ════ CLERESTORY — small arch windows above the arcade ══════════
  for (const sx of [-HX * 1.02, HX * 1.02]) {
    for (const z of [-0.04, 0, 0.04]) {
      await placeBody(win, 'arch', [sx, 0.046, z], [1.0, 1.4, 0.3], STONE);            // arch surround
      await placeBody(win, 'cube', [sx, 0.05, z], [0.018, 0.7, 0.7], GLASS);            // glass pane
    }
  }
  await win.screenshot({ path: path.join(OUT, '02-arcade-clerestory.png'), fullPage: false });

  // ════ RIB VAULT overhead — transverse arches + ogee diagonals ═══
  for (const z of colZ) {
    await placeBody(win, 'arch', [0, 0.03, z], [3.0, 2.2, 0.45], STONE);  // transverse rib spanning the nave
  }
  for (let i = 0; i < colZ.length - 1; i++) {
    const z = (colZ[i] + colZ[i + 1]) / 2;
    await placeBody(win, 'ogee', [0, 0.034, z], [3.2, 1.4, 0.4], STONE2, [0, PI / 2, 0]);  // longitudinal ridge ogee
    await placeBody(win, 'sphere', [0, 0.052, z], [0.45, 0.45, 0.45], STONE3);              // boss
  }
  await win.screenshot({ path: path.join(OUT, '03-vault.png'), fullPage: false });

  // ════ EAST WINDOW + ALTAR at the far (-Z) end ═══════════════════
  const ez = -0.085;
  await placeBody(win, 'cube', [0, 0.0, ez - 0.004], [3.4, 5.0, 0.2], DARK);          // end wall
  await placeBody(win, 'cube', [0, 0.0, ez], [2.2, 3.6, 0.1], GLASS);                  // big glass field
  await placeBody(win, 'cylinder', [-0.018, 0.0, ez + 0.002], [0.22, 3.4, 0.22], STONE);  // window jamb L
  await placeBody(win, 'cylinder', [0.018, 0.0, ez + 0.002], [0.22, 3.4, 0.22], STONE);   // window jamb R
  await placeBody(win, 'cylinder', [0, 0.0, ez + 0.002], [0.18, 3.4, 0.18], STONE2);       // central mullion
  await placeBody(win, 'arch', [0, 0.03, ez + 0.003], [3.0, 2.4, 0.4], STONE);             // window head arch
  await placeBody(win, 'ogee', [-0.011, 0.018, ez + 0.004], [1.3, 1.2, 0.35], STONE2);     // tracery lobe L
  await placeBody(win, 'ogee', [0.011, 0.018, ez + 0.004], [1.3, 1.2, 0.35], STONE2);      // tracery lobe R
  await placeBody(win, 'torus', [0, 0.04, ez + 0.004], [0.6, 0.6, 0.35], STONE3);          // rose oculus
  // Altar
  await placeBody(win, 'cube', [0, -0.05, -0.062], [1.4, 0.6, 0.7], STONE3);  // altar table
  await placeBody(win, 'cube', [0, -0.058, -0.062], [2.0, 0.4, 1.1], STONE2); // altar steps
  await win.screenshot({ path: path.join(OUT, '04-altar-window.png'), fullPage: false });
  const buildMs = Date.now() - t0;

  // ════ LIGHTING — dim interior + a glow from the east window ═════
  const lc = (w, h) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="color"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, h);
  const li = (w, v) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="intensity"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(x)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, v);
  // Make the glass self-lit so the windows glow like lit stained glass.
  await win.evaluate(() => { const vp = window.__archdiscViewport; vp.scene.traverse(o => { if (o.material && o.material.color && '#' + o.material.color.getHexString() === '7fa0c8') { o.material.emissive = o.material.color.clone(); o.material.emissiveIntensity = 0.8; o.material.needsUpdate = true; } }); });
  await tab(win, 'rendering');
  await lc(win, '#ffe9c8'); await li(win, '0.13'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#cfe0ff'); await li(win, '0.1'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#ffd9a0'); await li(win, '0.08'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);

  // ════ Assertions ════════════════════════════════════════════════
  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport; let prim = 0, lights = 0, ogee = 0, arch = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { prim++; const k = o.userData.archdiscStudioPrimitiveKind || ''; if (k === 'ogee') ogee++; if (k.indexOf('arch') === 0) arch++; } if (o.userData && o.userData.archdiscStudioLight) lights++; });
    return { prim, lights, ogee, arch };
  });
  expect(state.prim).toBeGreaterThanOrEqual(45);
  expect(state.lights).toBe(3);
  expect(state.ogee).toBeGreaterThanOrEqual(8);  // arcade + ridge + tracery ogees
  expect(state.arch).toBeGreaterThanOrEqual(11); // clerestory + transverse + window arches

  // ════ Multi-angle showcase — hero shot down the nave + around ═══
  await tab(win, 'rendering');
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);
  const shots = [[0, 8], [12, 6], [45, 20], [90, 16]];
  for (let i = 0; i < shots.length; i++) {
    await win.evaluate(([az, el]) => window.__archdiscOrbitView && window.__archdiscOrbitView(az, el, 1.0), shots[i]);
    await win.waitForTimeout(300);
    await win.screenshot({ path: path.join(OUT, `05-view-${i}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  chapel interior: ${state.prim} bodies (${state.ogee} ogee + ${state.arch} arch), build ${(buildMs / 1000).toFixed(1)}s`);

  await app.close();
});
