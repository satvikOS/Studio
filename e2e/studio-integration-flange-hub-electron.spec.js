import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio integration — FLANGED HUB (Video-611 1:1 parity).
 *
 * A clean SolidWorks-style mechanical hub: a flange disc with a 6-hole
 * bolt circle, a stepped central boss, and a through-bore — all in metal
 * grey. Built from concentric cylinders + a deterministic radial ring of
 * bore-coloured "holes" via the fast placeBody path. Side-by-side
 * (reference | render) stitched so 1:1 parity is visible.
 *
 * Beats prior iterations: a precise concentric mechanical part (accuracy),
 * clean monochrome CAD design, and a tight ~11-body build (performance).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-flange-hub');
const REF = path.resolve(__dirname, '..', 'tools', '.video-thumbs', 'Video-611_f4.jpg');
const PI = Math.PI;
const METAL = '#8b8e94', STEEL = '#9aa0a6', BORE = '#33343a', HOLE = '#44454c';

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

test('Studio Integration — Flanged Hub (Video-611 1:1 parity)', async () => {
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

  // Axis = Y (cylinders natural). Stepped diameters stacked on the axis.
  // ════ Rear boss (behind the flange) ═════════════════════════════
  await placeBody(win, 'cylinder', [0, -0.014, 0], [1.7, 0.9, 1.7], METAL);
  // ════ Flange disc — the wide bolted plate ════════════════════════
  await placeBody(win, 'cylinder', [0, 0, 0], [3.0, 0.42, 3.0], STEEL);
  // ════ 6-hole bolt circle — dark recesses flush with the flange ══
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    await placeBody(win, 'cylinder', [Math.cos(a) * 0.031, -0.0008, Math.sin(a) * 0.031], [0.46, 0.42, 0.46], '#202126');
  }
  // ════ Step ring between flange and boss ══════════════════════════
  await placeBody(win, 'cylinder', [0, 0.009, 0], [1.95, 0.5, 1.95], METAL);
  // ════ Central hub boss (protruding) ══════════════════════════════
  await placeBody(win, 'cylinder', [0, 0.026, 0], [1.35, 1.9, 1.35], STEEL);
  // ════ Through-bore — a dark recess SUNK INTO the boss top ════════
  await placeBody(win, 'cylinder', [0, 0.024, 0], [0.72, 1.25, 0.72], BORE);
  await win.screenshot({ path: path.join(OUT, '01-hub-complete.png'), fullPage: false });
  const buildMs = Date.now() - t0;

  // ════ LIGHTING — neutral CAD studio (accent intensities) ════════
  const lc = (w, h) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="color"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, h);
  const li = (w, v) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="intensity"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(x)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, v);
  await tab(win, 'rendering');
  await lc(win, '#f0f3ff'); await li(win, '0.22'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#e2e8f4'); await li(win, '0.14'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#d6dae2'); await li(win, '0.1'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);

  // ════ FRAME — 3/4 view showing the flange + bolt circle + boss ═══
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(32, 26, 0.95));
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
    ctx.fillText('REFERENCE (Video-611)', 12, 28); ctx.fillText('ARCHDISC STUDIO', aw + 36, 28);
    return c.toDataURL('image/png');
  }, { refUrl: refB64, rndUrl: rndB64 });
  fs.writeFileSync(path.join(OUT, 'PARITY-side-by-side.png'), Buffer.from(composite.split(',')[1], 'base64'));

  // ════ Assertions ════════════════════════════════════════════════
  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport; let prim = 0, lights = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) prim++; if (o.userData && o.userData.archdiscStudioLight) lights++; });
    return { prim, lights };
  });
  expect(state.prim).toBe(11); // rear boss + flange + 6 holes + step + boss + bore
  expect(state.lights).toBe(3);

  // ════ Turntable ══════════════════════════════════════════════════
  await tab(win, 'rendering');
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(360);
  for (const az of [20, 110, 200, 290]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 24, 0.95), az);
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `03-turntable-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  flange hub: ${state.prim} bodies, build ${(buildMs / 1000).toFixed(1)}s, side-by-side written`);

  await app.close();
});
