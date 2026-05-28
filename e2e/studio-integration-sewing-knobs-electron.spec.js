import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio integration — SEWING-MACHINE KNOBS (Video-402 1:1 parity).
 *
 * The reference is a close-up of a cream sewing-machine corner with two
 * round-topped control knobs (one cream, one orange), a dark oval badge,
 * and a side panel. Recreated from a cream body box + two capped cylinder
 * knobs + a dark plate + a side detail, via the fast placeBody path.
 * Side-by-side (reference | render) stitched so 1:1 parity is visible.
 *
 * Beats prior iterations: a recognizable photo-to-3D product corner with
 * cream/orange material contrast, clean design, tight fast build.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-sewing-knobs');
const REF = path.resolve(__dirname, '..', 'tools', '.video-thumbs', 'Video-402_f4.jpg');
const CREAM = '#d9d3c7', CREAM2 = '#cdc6b8', ORANGE = '#c46a2c', DARK = '#27272c';

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

test('Studio Integration — Sewing-Machine Knobs (Video-402 1:1 parity)', async () => {
  test.setTimeout(540000);
  fs.mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 6 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);
  await tab(win, 'modeling');

  // ════ Body — cream machine corner block ══════════════════════════
  await placeBody(win, 'cube', [0, 0, 0], [3.6, 1.7, 2.4], CREAM);
  // ════ Knob 1 — cream cylinder + rounded cap seated on top ════════
  await placeBody(win, 'cylinder', [-0.013, 0.032, -0.002], [0.55, 0.7, 0.55], CREAM2);
  await placeBody(win, 'sphere', [-0.013, 0.04, -0.002], [0.55, 0.3, 0.55], CREAM2);
  // ════ Knob 2 — orange cylinder + rounded cap seated on top ═══════
  await placeBody(win, 'cylinder', [0.012, 0.03, -0.002], [0.6, 0.6, 0.6], ORANGE);
  await placeBody(win, 'sphere', [0.012, 0.037, -0.002], [0.6, 0.32, 0.6], ORANGE);
  // ════ Dark oval badge on the front-left face ═════════════════════
  await placeBody(win, 'cylinder', [-0.04, 0.004, 0.0365], [0.55, 0.08, 0.95], DARK, [Math.PI / 2, 0, 0]);
  // ════ Side panel seam on the right ═══════════════════════════════
  await placeBody(win, 'cube', [0.052, 0.002, 0.005], [0.22, 0.95, 0.7], CREAM2);
  await win.screenshot({ path: path.join(OUT, '01-machine-corner.png'), fullPage: false });
  const buildMs = Date.now() - t0;

  // ════ LIGHTING — soft daylight (accent intensities) ═════════════
  const lc = (w, h) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="color"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, h);
  const li = (w, v) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="intensity"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(x)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, v);
  await tab(win, 'rendering');
  await lc(win, '#fff6ea'); await li(win, '0.15'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#eaf0fb'); await li(win, '0.1'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#fff0db'); await li(win, '0.08'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);

  // ════ FRAME — 3/4 close view of the corner + knobs ══════════════
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(28, 24, 0.9));
  await win.waitForTimeout(400);
  const vpRect = await win.evaluate(() => { const el = document.querySelector('.workbench-viewport'); const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
  await win.screenshot({ path: path.join(OUT, '02-render-ref-angle.png'), clip: vpRect });

  // ════ SIDE-BY-SIDE PARITY ════════════════════════════════════════
  const refB64 = 'data:image/jpeg;base64,' + fs.readFileSync(REF).toString('base64');
  const rndB64 = 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, '02-render-ref-angle.png')).toString('base64');
  const composite = await win.evaluate(async ({ refUrl, rndUrl }) => {
    const load = (u) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = u; });
    const [a, b] = await Promise.all([load(refUrl), load(rndUrl)]);
    const Hh = 760; const aw = a.width * (Hh / a.height), bw = b.width * (Hh / b.height);
    const c = document.createElement('canvas'); c.width = Math.round(aw + bw + 24); c.height = Hh;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(a, 0, 0, aw, Hh); ctx.drawImage(b, aw + 24, 0, bw, Hh);
    ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif';
    ctx.fillText('REFERENCE (Video-402)', 12, 28); ctx.fillText('ARCHDISC STUDIO', aw + 36, 28);
    return c.toDataURL('image/png');
  }, { refUrl: refB64, rndUrl: rndB64 });
  fs.writeFileSync(path.join(OUT, 'PARITY-side-by-side.png'), Buffer.from(composite.split(',')[1], 'base64'));

  // ════ Assertions ════════════════════════════════════════════════
  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport; let prim = 0, lights = 0; const cols = new Set();
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { prim++; if (o.material && o.material.color) cols.add(o.material.color.getHexString()); } if (o.userData && o.userData.archdiscStudioLight) lights++; });
    return { prim, lights, colors: cols.size };
  });
  expect(state.prim).toBe(7); // body + 2 knobs + 2 caps + badge + side panel
  expect(state.lights).toBe(3);
  expect(state.colors).toBeGreaterThanOrEqual(3); // cream / orange / dark

  // ════ Turntable ══════════════════════════════════════════════════
  await tab(win, 'rendering');
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(360);
  for (const az of [20, 110, 200, 290]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 0.9), az);
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `03-turntable-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  sewing knobs: ${state.prim} bodies, ${state.colors} colours, build ${(buildMs / 1000).toFixed(1)}s, side-by-side written`);

  await app.close();
});
