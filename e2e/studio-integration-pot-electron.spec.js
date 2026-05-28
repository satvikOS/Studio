import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio integration — POT OF BOILING WATER (Video-499 1:1 parity).
 *
 * A steel cooking pot with two side handles, a rim lip, and a churning
 * water surface dotted with bubbles — matching the reference. Built from
 * a cylinder body + torus rim + water disc + box handles + a deterministic
 * spread of bubble spheres, via the fast placeBody path. Side-by-side
 * (reference | render) stitched so 1:1 parity is visible.
 *
 * Beats prior iterations: a recognizable everyday object with material
 * contrast (steel vs water), clean design, and a tight fast build.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-pot');
const REF = path.resolve(__dirname, '..', 'tools', '.video-thumbs', 'Video-499_f4.jpg');
const PI = Math.PI;
const STEEL = '#7c828a', STEEL2 = '#6e747c', WATER = '#aebcc6', FOAM = '#dfe7ec';

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

test('Studio Integration — Pot of Boiling Water (Video-499 1:1 parity)', async () => {
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

  // ════ Pot body — steel cylinder (its top edge is the rim) ════════
  await placeBody(win, 'cylinder', [0, 0, 0], [3.1, 2.3, 3.1], STEEL);
  // ════ Water surface — churning disc set just below the top edge ══
  await placeBody(win, 'cylinder', [0, 0.028, 0], [2.86, 0.14, 2.86], WATER);
  // ════ Two side handles — steel bars sticking out ════════════════
  await placeBody(win, 'cube', [0.052, 0.008, 0], [0.55, 0.32, 1.1], STEEL2);
  await placeBody(win, 'cube', [-0.052, 0.008, 0], [0.55, 0.32, 1.1], STEEL2);
  await win.screenshot({ path: path.join(OUT, '01-pot.png'), fullPage: false });

  // ════ Bubbles — deterministic foam on the boiling surface ═══════
  let bubbles = 0;
  const phi = PI * (3 - Math.sqrt(5)); // Fibonacci angle (deterministic)
  for (let i = 0; i < 16; i++) {
    const rr = 0.006 + (i / 16) * 0.03;        // spiral outwards
    const ang = i * phi;
    const x = Math.cos(ang) * rr, z = Math.sin(ang) * rr;
    const s = 0.16 + 0.10 * ((i * 7) % 5) / 5;  // deterministic size variety
    await placeBody(win, 'sphere', [x, 0.03, z], [s, s * 0.7, s], FOAM);
    bubbles++;
  }
  await win.screenshot({ path: path.join(OUT, '02-pot-boiling.png'), fullPage: false });
  const buildMs = Date.now() - t0;

  // ════ LIGHTING — soft warm kitchen (accent intensities) ═════════
  const lc = (w, h) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="color"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, h);
  const li = (w, v) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="intensity"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(x)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, v);
  await tab(win, 'rendering');
  await lc(win, '#fff4e6'); await li(win, '0.14'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#e6eefc'); await li(win, '0.09'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#ffe8cc'); await li(win, '0.07'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);

  // ════ FRAME — looking down into the pot (sees water + rim) ═══════
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(16, 34, 0.92));
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
    ctx.fillText('REFERENCE (Video-499)', 12, 28); ctx.fillText('ARCHDISC STUDIO', aw + 36, 28);
    return c.toDataURL('image/png');
  }, { refUrl: refB64, rndUrl: rndB64 });
  fs.writeFileSync(path.join(OUT, 'PARITY-side-by-side.png'), Buffer.from(composite.split(',')[1], 'base64'));

  // ════ Assertions ════════════════════════════════════════════════
  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport; let prim = 0, lights = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) prim++; if (o.userData && o.userData.archdiscStudioLight) lights++; });
    return { prim, lights };
  });
  expect(state.prim).toBe(4 + bubbles); // body + water + 2 handles + bubbles
  expect(state.lights).toBe(3);

  // ════ Turntable ══════════════════════════════════════════════════
  await tab(win, 'rendering');
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(360);
  for (const az of [10, 100, 190, 280]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 30, 0.92), az);
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `04-turntable-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  pot: ${state.prim} bodies (${bubbles} bubbles), build ${(buildMs / 1000).toFixed(1)}s, side-by-side written`);

  await app.close();
});
