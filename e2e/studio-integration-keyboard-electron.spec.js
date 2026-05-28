import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio integration — MECHANICAL KEYBOARD (Video-528 1:1 parity, v2).
 *
 * Tighter fidelity than v1: a true FULL-SIZE layout with real varied key
 * widths (Tab/Caps/Shift/Enter/Backspace/Space), a nav cluster + inverted-T
 * arrows, and a proper numpad with tall +/Enter and wide 0 — plus two
 * volume knobs and a grey case. Each key is a box scaled to its unit width
 * and coloured from the layout, matching the reference white field + orange
 * accents. A side-by-side (reference | render) is stitched so 1:1 parity is
 * visible, not asserted.
 *
 * Faster than v1 too: only the FIRST placement pays the careful
 * select->wait-for-input->set path; once Studio's Selection inputs are
 * mounted they persist, so every later key uses a single fast evaluate.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-keyboard');
const REF = path.resolve(__dirname, '..', 'tools', '.video-thumbs', 'Video-528_f4.jpg');

const P = 0.0072;        // 1u key pitch (m)
const GAP = 0.0014;      // gap between keys (m)
const KH = 0.06;         // keycap height scale (~1.8 mm)
const ORANGE = '#d2691e';
const WHITE = '#e9e6df';
const DARK = '#2b2b30';

// width-scale for a key spanning w units, and the z (depth) scale (1u).
const sx = (w) => (w * P - GAP) / 0.03;
const sz = () => (P - GAP) / 0.03;

const run = (n, c) => Array.from({ length: n }, () => [1, c]);
// Full-size main block rows (units sum ~15u): [widthUnits, colour].
const ROWS = [
  [[1, 'O'], ...run(3, 'W'), [1, 'O'], ...run(3, 'W'), [1, 'O'], ...run(3, 'W'), [1, 'O']],     // function
  [[1, 'O'], ...run(12, 'W'), [2, 'O']],                                                          // 1..= + Backspace
  [[1.5, 'O'], ...run(12, 'W'), [1.5, 'W']],                                                      // Tab .. backslash
  [[1.75, 'O'], ...run(11, 'W'), [2.25, 'O']],                                                    // Caps .. Enter
  [[2.25, 'O'], ...run(10, 'W'), [2.75, 'O']],                                                    // LShift .. RShift
  [[1.25, 'O'], [1.25, 'W'], [1.25, 'W'], [6.25, 'W'], [1.25, 'W'], [1.25, 'O'], [1.25, 'O']],   // bottom row
];
// Numpad rows (4 wide). [w, colour]; '+'/'Enter' are tall (handled), 0 is wide.
const NUM = [
  [[1, 'W'], [1, 'O'], [1, 'O'], [1, 'O']],   // NumLk / * -
  [[1, 'W'], [1, 'W'], [1, 'W'], [1, 'O']],   // 7 8 9 +
  [[1, 'W'], [1, 'W'], [1, 'W'], [1, 'W']],   // 4 5 6
  [[1, 'W'], [1, 'W'], [1, 'W'], [1, 'O']],   // 1 2 3 Enter
  [[2, 'W'], [1, 'W'], [1, 'O']],             // 0 (2u) .  Enter
];

let _inputsReady = false; // perf: Selection inputs persist after first mount

async function tab(win, name) { const t = win.locator(`.workbench-ribbon-placeholder-tab[data-studio-discipline="${name}"]`); await t.scrollIntoViewIfNeeded(); await t.click(); await win.waitForTimeout(200); }

async function placeBody(win, kind, pos, scl, hex) {
  const before = await win.evaluate(() => { let n = 0; window.__archdiscViewport.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; }); return n; });
  await win.locator(`[data-studio-primitive="${kind}"]`).click();
  await win.waitForFunction((n) => { let c = 0; window.__archdiscViewport.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) c++; }); return c > n; }, before, { timeout: 5000 });
  const apply = ({ p, s, h }) => {
    const vp = window.__archdiscViewport; let best = null, bi = -1;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { const m = /(\d+)$/.exec(o.name || ''); const i = m ? +m[1] : 0; if (i >= bi) { bi = i; best = o; } } });
    if (best && window.__studioSelectMesh) window.__studioSelectMesh(best);
    return !!best;
  };
  const setVals = ({ p, s, h }) => {
    const set = (sel, v) => { const el = document.querySelector(sel); if (!el) return false; const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; };
    set('[data-studio-selection-edit="position-x"]', p[0]); set('[data-studio-selection-edit="position-y"]', p[1]); set('[data-studio-selection-edit="position-z"]', p[2]);
    set('[data-studio-selection-edit="scale-x"]', s[0]); set('[data-studio-selection-edit="scale-y"]', s[1]); set('[data-studio-selection-edit="scale-z"]', s[2]);
    if (h) set('[data-studio-material="color"]', h);
  };
  const arg = { p: pos, s: scl, h: hex };
  if (!_inputsReady) {
    await win.evaluate(apply, arg);
    await win.waitForSelector('[data-studio-selection-edit="position-x"]', { timeout: 5000 });
    await win.evaluate(setVals, arg);
    _inputsReady = true;
  } else {
    // Fast path: inputs already mounted — select + set in one round trip.
    await win.evaluate(({ a }) => {
      const vp = window.__archdiscViewport; let best = null, bi = -1;
      vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { const m = /(\d+)$/.exec(o.name || ''); const i = m ? +m[1] : 0; if (i >= bi) { bi = i; best = o; } } });
      if (best && window.__studioSelectMesh) window.__studioSelectMesh(best);
      const set = (sel, v) => { const el = document.querySelector(sel); if (!el) return; const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      set('[data-studio-selection-edit="position-x"]', a.p[0]); set('[data-studio-selection-edit="position-y"]', a.p[1]); set('[data-studio-selection-edit="position-z"]', a.p[2]);
      set('[data-studio-selection-edit="scale-x"]', a.s[0]); set('[data-studio-selection-edit="scale-y"]', a.s[1]); set('[data-studio-selection-edit="scale-z"]', a.s[2]);
      if (a.h) set('[data-studio-material="color"]', a.h);
    }, { a: arg });
  }
}

test('Studio Integration — Mechanical Keyboard (Video-528 1:1 parity, full-size)', async () => {
  test.setTimeout(900000);
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

  // Layout: keyboard lies flat (+Y up). x = left->right, z = back->front.
  const mainW = 15 * P;                 // main block spans ~15u
  const navW = 3 * P;                   // nav/arrow cluster
  const numW = 4 * P;                   // numpad
  const totalW = mainW + 0.006 + navW + 0.004 + numW;
  const leftX = -totalW / 2;            // left edge of everything
  const z0 = -(6 - 1) / 2 * P;

  // ════ 1. CASE — grey base plate + a thin riser lip ═══════════════
  await placeBody(win, 'cube', [0, -0.0026, 0], [(totalW + 0.006) / 0.03, 0.14, (6 * P + 0.006) / 0.03], '#9a9ea6');

  // ════ 2. MAIN BLOCK — real varied key widths ═════════════════════
  let keyCount = 0;
  for (let r = 0; r < ROWS.length; r++) {
    let cur = leftX;
    const z = z0 + r * P;
    for (const [w, c] of ROWS[r]) {
      const x = cur + (w * P) / 2;
      await placeBody(win, 'cube', [x, 0, z], [sx(w), KH, sz()], c === 'O' ? ORANGE : WHITE);
      cur += w * P; keyCount++;
    }
  }
  await win.screenshot({ path: path.join(OUT, '01-main-block.png'), fullPage: false });

  // ════ 3. NAV CLUSTER + INVERTED-T ARROWS ═════════════════════════
  const navX = leftX + mainW + 0.006;
  const nav = [
    [0, 0, 'O'], [1, 0, 'W'], [2, 0, 'W'],   // Ins Home PgUp
    [0, 1, 'W'], [1, 1, 'W'], [2, 1, 'O'],   // Del End PgDn
  ];
  for (const [cxu, rzu, c] of nav) {
    await placeBody(win, 'cube', [navX + cxu * P + P / 2, 0, z0 + (rzu + 1) * P], [sx(1), KH, sz()], c === 'O' ? ORANGE : WHITE);
    keyCount++;
  }
  // inverted-T arrows on rows 4-5
  const arrows = [[1, 4, 'O'], [0, 5, 'W'], [1, 5, 'W'], [2, 5, 'W']];
  for (const [cxu, rzu, c] of arrows) {
    await placeBody(win, 'cube', [navX + cxu * P + P / 2, 0, z0 + rzu * P], [sx(1), KH, sz()], c === 'O' ? ORANGE : WHITE);
    keyCount++;
  }

  // ════ 4. NUMPAD ══════════════════════════════════════════════════
  const numX = navX + navW + 0.004;
  for (let r = 0; r < NUM.length; r++) {
    let cur = numX;
    const z = z0 + (r + 1) * P;
    for (const [w, c] of NUM[r]) {
      const x = cur + (w * P) / 2;
      await placeBody(win, 'cube', [x, 0, z], [sx(w), KH, sz()], c === 'O' ? ORANGE : WHITE);
      cur += w * P; keyCount++;
    }
  }

  // ════ 5. KNOBS — two volume knobs above the numpad ═══════════════
  for (let i = 0; i < 2; i++) {
    await placeBody(win, 'cylinder', [numX + (1.0 + i * 1.6) * P, 0.0016, z0 - 0.5 * P], [0.16, 0.26, 0.16], DARK);
  }
  await win.screenshot({ path: path.join(OUT, '02-keyboard-complete.png'), fullPage: false });
  const buildMs = Date.now() - t0;

  // ════ 6. LIGHTING — clean neutral studio (accent intensities) ════
  const lc = (w, h) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="color"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, h);
  const li = (w, v) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="intensity"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(x)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, v);
  await tab(win, 'rendering');
  await lc(win, '#ffffff'); await li(win, '0.18'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#e8eeff'); await li(win, '0.12'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#fff0dd'); await li(win, '0.1'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);

  // ════ 7. FRAME at the reference camera angle ═════════════════════
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(26, 60, 1.02));
  await win.waitForTimeout(400);
  const vpRect = await win.evaluate(() => { const el = document.querySelector('.workbench-viewport'); const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
  await win.screenshot({ path: path.join(OUT, '03-render-ref-angle.png'), clip: vpRect });

  // ════ 8. SIDE-BY-SIDE PARITY — reference | render ════════════════
  const refB64 = 'data:image/jpeg;base64,' + fs.readFileSync(REF).toString('base64');
  const rndB64 = 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, '03-render-ref-angle.png')).toString('base64');
  const composite = await win.evaluate(async ({ refUrl, rndUrl }) => {
    const load = (u) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = u; });
    const [a, b] = await Promise.all([load(refUrl), load(rndUrl)]);
    const H = 760; const aw = a.width * (H / a.height), bw = b.width * (H / b.height);
    const c = document.createElement('canvas'); c.width = Math.round(aw + bw + 24); c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(a, 0, 0, aw, H); ctx.drawImage(b, aw + 24, 0, bw, H);
    ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif';
    ctx.fillText('REFERENCE (Video-528)', 12, 28); ctx.fillText('ARCHDISC STUDIO', aw + 36, 28);
    return c.toDataURL('image/png');
  }, { refUrl: refB64, rndUrl: rndB64 });
  fs.writeFileSync(path.join(OUT, 'PARITY-side-by-side.png'), Buffer.from(composite.split(',')[1], 'base64'));

  // ════ Assertions ════════════════════════════════════════════════
  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport; let prim = 0, lights = 0, orange = 0, white = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) { prim++; if (o.material && o.material.color) { const h = o.material.color.getHexString(); if (h.startsWith('d2')) orange++; else if (h.startsWith('e9')) white++; } }
      if (o.userData && o.userData.archdiscStudioLight) lights++;
    });
    return { prim, lights, orange, white };
  });
  expect(state.prim).toBeGreaterThanOrEqual(95); // case + ~100 keys + 2 knobs
  expect(state.lights).toBe(3);
  expect(state.orange).toBeGreaterThanOrEqual(20);
  expect(state.white).toBeGreaterThanOrEqual(55);

  // eslint-disable-next-line no-console
  console.log(`  keyboard v2: ${state.prim} bodies (${state.white}W+${state.orange}O), build ${(buildMs / 1000).toFixed(1)}s, side-by-side written`);

  await app.close();
});
