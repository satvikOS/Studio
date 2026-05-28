import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio integration — MECHANICAL KEYBOARD (Video-528 1:1 parity).
 *
 * A faithful recreation of the reference keyboard: a grey case, a full
 * white/orange keycap GRID (each cell coloured from a layout pattern so
 * the white field + orange accents match), a numpad block, and two volume
 * knobs. Built key-by-key through the UI for an accurate layout.
 *
 * Crucially this spec STITCHES a side-by-side (reference frame | my
 * render) so 1:1 parity is directly visible and judged honestly — the
 * thing the earlier abstract scenes never showed.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-keyboard');
const REF = path.resolve(__dirname, '..', 'tools', '.video-thumbs', 'Video-528_f4.jpg');

const P = 0.0072;          // key pitch (m)
// Scale MULTIPLIERS fed to setXform (world size = 0.03 * scale). 0.2 ->
// 6 mm keycaps with a ~1.2 mm gap at the 7.2 mm pitch; 0.06 -> ~1.8 mm tall.
const KEY = [0.2, 0.06, 0.2];
const ORANGE = '#d2691e';
const WHITE = '#e9e6df';
const CASE = '#9a9ea6';

// Main block layout (15 cols x 6 rows). O=orange W=white .=no key.
const MAIN = [
  'OOOO.WWWW.OOOO.',
  'OWWWWWWWWWWWWOO',
  'OWWWWWWWWWWWWWO',
  'OWWWWWWWWWWWWO.',
  'OWWWWWWWWWWOO..',
  'OOO..WWWWW..OOO',
];
// Numpad (4 cols x 5 rows), placed to the right of the main block.
const NUM = ['WWWO', 'WWWO', 'WWWW', 'WWWO', 'WWOO'];

async function tab(win, name) { const t = win.locator(`.workbench-ribbon-placeholder-tab[data-studio-discipline="${name}"]`); await t.scrollIntoViewIfNeeded(); await t.click(); await win.waitForTimeout(200); }
async function addPrim(win, kind) { await win.locator(`[data-studio-primitive="${kind}"]`).click(); await win.waitForTimeout(110); }
// Race-safe body placement: spawn the primitive, wait until it exists,
// select the newest, WAIT for the Selection transform inputs to mount
// (__studioSelectMesh updates React state — the inputs render on the NEXT
// tick, so setting them in the same tick silently no-ops and leaves a
// default-size cube), THEN set transform + colour.
async function placeBody(win, kind, pos, scl, hex) {
  const before = await win.evaluate(() => { let n = 0; window.__archdiscViewport.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; }); return n; });
  await win.locator(`[data-studio-primitive="${kind}"]`).click();
  await win.waitForFunction((n) => { let c = 0; window.__archdiscViewport.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) c++; }); return c > n; }, before, { timeout: 5000 });
  await win.evaluate(() => {
    const vp = window.__archdiscViewport; let best = null, bi = -1;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { const m = /(\d+)$/.exec(o.name || ''); const i = m ? +m[1] : 0; if (i >= bi) { bi = i; best = o; } } });
    if (best && window.__studioSelectMesh) window.__studioSelectMesh(best);
  });
  await win.waitForSelector('[data-studio-selection-edit="position-x"]', { timeout: 5000 });
  await win.evaluate(({ p, s, h }) => {
    const set = (sel, v) => { const el = document.querySelector(sel); if (!el) return; const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('[data-studio-selection-edit="position-x"]', p[0]); set('[data-studio-selection-edit="position-y"]', p[1]); set('[data-studio-selection-edit="position-z"]', p[2]);
    set('[data-studio-selection-edit="scale-x"]', s[0]); set('[data-studio-selection-edit="scale-y"]', s[1]); set('[data-studio-selection-edit="scale-z"]', s[2]);
    if (h) set('[data-studio-material="color"]', h);
  }, { p: pos, s: scl, h: hex });
  await win.waitForTimeout(25);
}

test('Studio Integration — Mechanical Keyboard (Video-528 1:1 parity)', async () => {
  test.setTimeout(900000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 8 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);
  await tab(win, 'modeling');

  // Geometry: keyboard lies flat (keys' top faces +Y). x = left->right,
  // z = back->front. Centre the whole unit around the origin.
  const cols = 15, numCols = 4;
  const totalCols = cols + 1 + numCols;       // main + gap + numpad
  const cx = (totalCols - 1) / 2 * P;          // centre offset
  const x0 = -cx;
  const z0 = -(6 - 1) / 2 * P;

  // ════ 1. CASE — grey base plate under everything ═════════════════
  await placeBody(win, 'cube', [0, -0.0022, 0], [(totalCols * P + 0.004) / 0.03, 0.12, (6 * P + 0.004) / 0.03], '#9a9ea6');

  // ════ 2. MAIN KEY GRID — one keycap per non-empty cell ═══════════
  let keyCount = 0;
  for (let r = 0; r < MAIN.length; r++) {
    const row = MAIN[r];
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      await placeBody(win, 'cube', [x0 + c * P, 0, z0 + r * P], KEY, ch === 'O' ? ORANGE : WHITE);
      keyCount++;
    }
  }
  await win.screenshot({ path: path.join(OUT, '01-main-block.png'), fullPage: false });

  // ════ 3. NUMPAD — block to the right of the main grid ════════════
  const nx0 = x0 + (cols + 1) * P;
  for (let r = 0; r < NUM.length; r++) {
    for (let c = 0; c < NUM[r].length; c++) {
      const ch = NUM[r][c];
      await placeBody(win, 'cube', [nx0 + c * P, 0, z0 + (r + 1) * P], KEY, ch === 'O' ? ORANGE : WHITE);
      keyCount++;
    }
  }

  // ════ 4. KNOBS — two volume knobs above the numpad ═══════════════
  for (let i = 0; i < 2; i++) {
    await placeBody(win, 'cylinder', [nx0 + (1.4 + i * 1.4) * P, 0.001, z0 - 0.4 * P], [0.18, 0.22, 0.18], '#2b2b30');
  }
  await win.screenshot({ path: path.join(OUT, '02-keyboard-complete.png'), fullPage: false });

  // ════ 5. LIGHTING — clean neutral studio (accent intensities) ════
  const lc = (w, h) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="color"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, h);
  const li = (w, v) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="intensity"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(x)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, v);
  await tab(win, 'rendering');
  await lc(win, '#ffffff'); await li(win, '0.18'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(120);
  await lc(win, '#e8eeff'); await li(win, '0.12'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(120);
  await lc(win, '#fff0dd'); await li(win, '0.1'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(120);

  // ════ 6. FRAME at the reference camera angle (top-down 3/4) ══════
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(28, 58, 1.05));
  await win.waitForTimeout(400);
  // Clip to just the 3D viewport rectangle so the side-by-side shows the
  // render, not the app chrome.
  const vpRect = await win.evaluate(() => { const el = document.querySelector('.workbench-viewport'); const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
  await win.screenshot({ path: path.join(OUT, '03-render-ref-angle.png'), clip: vpRect });

  // ════ 7. SIDE-BY-SIDE PARITY — reference | my render ═════════════
  const refB64 = 'data:image/jpeg;base64,' + fs.readFileSync(REF).toString('base64');
  const renderB64 = 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, '03-render-ref-angle.png')).toString('base64');
  const composite = await win.evaluate(async ({ refUrl, rndUrl }) => {
    const load = (u) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = u; });
    const [a, b] = await Promise.all([load(refUrl), load(rndUrl)]);
    const H = 760;
    const aw = a.width * (H / a.height), bw = b.width * (H / b.height);
    const c = document.createElement('canvas'); c.width = Math.round(aw + bw + 24); c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(a, 0, 0, aw, H); ctx.drawImage(b, aw + 24, 0, bw, H);
    ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif';
    ctx.fillText('REFERENCE (Video-528)', 12, 28); ctx.fillText('ARCHDISC STUDIO', aw + 36, 28);
    return c.toDataURL('image/png');
  }, { refUrl: refB64, rndUrl: renderB64 });
  fs.writeFileSync(path.join(OUT, 'PARITY-side-by-side.png'), Buffer.from(composite.split(',')[1], 'base64'));

  // ════ Assertions ════════════════════════════════════════════════
  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport; let prim = 0, lights = 0, orange = 0, white = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        prim++;
        if (o.material && o.material.color) { const h = o.material.color.getHexString(); if (h.startsWith('d2') || h.startsWith('d1')) orange++; else if (h.startsWith('e9') || h.startsWith('e8')) white++; }
      }
      if (o.userData && o.userData.archdiscStudioLight) lights++;
    });
    return { prim, lights, orange, white };
  });
  expect(state.prim).toBeGreaterThanOrEqual(90); // case + ~95 keys + 2 knobs
  expect(state.lights).toBe(3);
  expect(state.orange).toBeGreaterThanOrEqual(20); // orange accent keys present
  expect(state.white).toBeGreaterThanOrEqual(40);  // white field present

  // eslint-disable-next-line no-console
  console.log(`  keyboard: ${state.prim} bodies (${state.white} white + ${state.orange} orange keys), side-by-side written`);

  await app.close();
});
