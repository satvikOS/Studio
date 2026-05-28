import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio integration — ROBOT ARM JOINT (Video-12 1:1 parity).
 *
 * A hard-surface mechanical joint matching the reference's grey arm
 * segments meeting a blue housing with an orange ring band, a bolted top
 * cap, and two blue triangular fins. Built from cylinders / torus / cones
 * / boxes via the fast placeBody path; bolts placed on a deterministic
 * ring. Side-by-side (reference | render) stitched so 1:1 parity is
 * visible.
 *
 * Aims to beat prior iterations: recognizable mechanical design, exact
 * colour scheme + form, and a tight ~15-body build.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-robot-joint');
const REF = path.resolve(__dirname, '..', 'tools', '.video-thumbs', 'Video-12_f4.jpg');
const PI = Math.PI;
const GREY = '#6e7178', BLUE = '#2f7fd6', ORANGE = '#e08a2a', DARK = '#3a3d44';

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

test('Studio Integration — Robot Arm Joint (Video-12 1:1 parity)', async () => {
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

  // ════ Lower arm — grey segment plugging into the joint base ══════
  await placeBody(win, 'cylinder', [-0.014, -0.02, 0], [0.5, 1.5, 0.5], GREY, [0, 0, 0.42]);
  // ════ Joint housing — blue drum at the elbow ═════════════════════
  await placeBody(win, 'cylinder', [0, 0, 0], [1.0, 1.05, 1.0], BLUE, [0, 0, 0]);
  // ════ Orange ring band hugging the housing waist ════════════════
  await placeBody(win, 'torus', [0, -0.001, 0], [1.0, 1.0, 0.4], ORANGE, [PI / 2, 0, 0]);
  // ════ Grey top cap ═══════════════════════════════════════════════
  await placeBody(win, 'cylinder', [0, 0.015, 0], [0.86, 0.36, 0.86], GREY, [0, 0, 0]);
  await win.screenshot({ path: path.join(OUT, '01-housing.png'), fullPage: false });

  // ════ Bolt ring on the cap (6 deterministic positions) ══════════
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    await placeBody(win, 'cylinder', [Math.cos(a) * 0.0072, 0.0225, Math.sin(a) * 0.0072], [0.09, 0.12, 0.09], DARK, [0, 0, 0]);
  }
  // ════ Two blue triangular fins on top ════════════════════════════
  await placeBody(win, 'cone', [-0.0052, 0.027, 0.001], [0.3, 0.78, 0.2], BLUE, [0.12, 0, 0.1]);
  await placeBody(win, 'cone', [0.0052, 0.027, 0.001], [0.3, 0.78, 0.2], BLUE, [0.12, 0, -0.1]);
  // ════ Upper arm — grey segment leaving the joint top-right ═══════
  await placeBody(win, 'cylinder', [0.015, 0.02, 0], [0.48, 1.4, 0.48], GREY, [0, 0, -0.48]);
  await win.screenshot({ path: path.join(OUT, '02-joint-complete.png'), fullPage: false });
  const buildMs = Date.now() - t0;

  // ════ LIGHTING — neutral studio (accent intensities) ════════════
  const lc = (w, h) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="color"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, h);
  const li = (w, v) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="intensity"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(x)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, v);
  await tab(win, 'rendering');
  await lc(win, '#eef2ff'); await li(win, '0.2'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#dfe6f5'); await li(win, '0.13'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#fff0dd'); await li(win, '0.1'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);

  // ════ FRAME — 3/4 view of the joint ══════════════════════════════
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(35, 18, 0.95));
  await win.waitForTimeout(400);
  const vpRect = await win.evaluate(() => { const el = document.querySelector('.workbench-viewport'); const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
  await win.screenshot({ path: path.join(OUT, '03-render-ref-angle.png'), clip: vpRect });

  // ════ SIDE-BY-SIDE PARITY ════════════════════════════════════════
  const refB64 = 'data:image/jpeg;base64,' + fs.readFileSync(REF).toString('base64');
  const rndB64 = 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, '03-render-ref-angle.png')).toString('base64');
  const composite = await win.evaluate(async ({ refUrl, rndUrl }) => {
    const load = (u) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = u; });
    const [a, b] = await Promise.all([load(refUrl), load(rndUrl)]);
    const Hh = 760; const aw = a.width * (Hh / a.height), bw = b.width * (Hh / b.height);
    const c = document.createElement('canvas'); c.width = Math.round(aw + bw + 24); c.height = Hh;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(a, 0, 0, aw, Hh); ctx.drawImage(b, aw + 24, 0, bw, Hh);
    ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif';
    ctx.fillText('REFERENCE (Video-12)', 12, 28); ctx.fillText('ARCHDISC STUDIO', aw + 36, 28);
    return c.toDataURL('image/png');
  }, { refUrl: refB64, rndUrl: rndB64 });
  fs.writeFileSync(path.join(OUT, 'PARITY-side-by-side.png'), Buffer.from(composite.split(',')[1], 'base64'));

  // ════ Assertions ════════════════════════════════════════════════
  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport; let prim = 0, lights = 0; const cols = new Set();
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { prim++; if (o.material && o.material.color) cols.add(o.material.color.getHexString()); } if (o.userData && o.userData.archdiscStudioLight) lights++; });
    return { prim, lights, colors: cols.size };
  });
  expect(state.prim).toBe(13); // arms(2) + housing + ring + cap + 6 bolts + 2 fins
  expect(state.lights).toBe(3);
  expect(state.colors).toBeGreaterThanOrEqual(4); // grey/blue/orange/dark

  // ════ Turntable ══════════════════════════════════════════════════
  await tab(win, 'rendering');
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(360);
  for (const az of [25, 115, 205, 295]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 16, 0.95), az);
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `04-turntable-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  robot joint: ${state.prim} bodies, ${state.colors} colours, build ${(buildMs / 1000).toFixed(1)}s, side-by-side written`);

  await app.close();
});
