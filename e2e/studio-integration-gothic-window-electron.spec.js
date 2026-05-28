import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio integration — GOTHIC TRACERY WINDOW (Video-741 1:1 parity).
 *
 * The reference is moulded stone gothic tracery (pointed/lancet arches with
 * an oculus). Building it surfaced a tool gap (Rule 2): the primitive set
 * had only a FULL torus ring, so arches were impossible. A new "Arch"
 * primitive (a half-arc torus bar) was integrated, then used here to build
 * a pointed-arch window: stone jambs, a lancet arch head, a central
 * mullion, two sub-arch lights, and an oculus ring. Side-by-side stitched
 * so 1:1 parity is visible.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-gothic-window');
const REF = path.resolve(__dirname, '..', 'tools', '.video-thumbs', 'Video-741_f4.jpg');
const STONE = '#b9b4aa', STONE2 = '#a8a298';

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

test('Studio Integration — Gothic Tracery Window (Video-741 1:1 parity)', async () => {
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

  // Window stands in the XY plane (we view it face-on along +Z). The Arch
  // primitive is a half-torus: ends on the X axis, apex up — a ready arch.
  // ════ Sill — stone base bar ══════════════════════════════════════
  await placeBody(win, 'cube', [0, -0.036, 0], [2.6, 0.28, 0.5], STONE);
  // ════ Two jambs — vertical side mullions ═════════════════════════
  await placeBody(win, 'cylinder', [-0.03, -0.006, 0], [0.32, 2.1, 0.32], STONE);
  await placeBody(win, 'cylinder', [0.03, -0.006, 0], [0.32, 2.1, 0.32], STONE);
  // ════ Central mullion — splits the window into two lights ════════
  await placeBody(win, 'cylinder', [0, -0.006, 0], [0.26, 2.1, 0.26], STONE2);
  // ════ Lancet arch head — tall half-arc spanning the jambs ════════
  await placeBody(win, 'arch', [0, 0.025, 0], [4.2, 6.0, 0.7], STONE);
  // ════ Two sub-arch lights under the head ═════════════════════════
  await placeBody(win, 'arch', [-0.015, 0.012, 0.004], [1.9, 3.0, 0.6], STONE2);
  await placeBody(win, 'arch', [0.015, 0.012, 0.004], [1.9, 3.0, 0.6], STONE2);
  // ════ Oculus — tracery ring in the arch apex ════════════════════
  await placeBody(win, 'torus', [0, 0.05, 0.004], [0.9, 0.9, 0.6], STONE2);
  await win.screenshot({ path: path.join(OUT, '01-window.png'), fullPage: false });
  const buildMs = Date.now() - t0;

  // ════ LIGHTING — soft stone daylight (accent intensities) ═══════
  const lc = (w, h) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="color"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, h);
  const li = (w, v) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="intensity"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(x)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, v);
  await tab(win, 'rendering');
  await lc(win, '#fff6ea'); await li(win, '0.2'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#e8eefc'); await li(win, '0.13'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#fff0db'); await li(win, '0.1'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);

  // ════ FRAME — face-on view of the window ═════════════════════════
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(0, 4, 0.92));
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
    ctx.fillText('REFERENCE (Video-741)', 12, 28); ctx.fillText('ARCHDISC STUDIO', aw + 36, 28);
    return c.toDataURL('image/png');
  }, { refUrl: refB64, rndUrl: rndB64 });
  fs.writeFileSync(path.join(OUT, 'PARITY-side-by-side.png'), Buffer.from(composite.split(',')[1], 'base64'));

  // ════ Assertions ════════════════════════════════════════════════
  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport; let prim = 0, lights = 0, arches = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { prim++; if (o.userData.archdiscStudioPrimitiveKind === 'arch') arches++; } if (o.userData && o.userData.archdiscStudioLight) lights++; });
    return { prim, lights, arches };
  });
  expect(state.prim).toBe(8);  // sill + 2 jambs + mullion + head + 2 sub-arches + oculus
  expect(state.lights).toBe(3);
  expect(state.arches).toBeGreaterThanOrEqual(3); // the new Arch primitive in use

  // ════ Turntable — show the relief ════════════════════════════════
  await tab(win, 'rendering');
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(360);
  for (const az of [0, 20, -20, 40]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 6, 0.92), az);
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `03-view-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  gothic window: ${state.prim} bodies (${state.arches} arches), build ${(buildMs / 1000).toFixed(1)}s, side-by-side written`);

  await app.close();
});
