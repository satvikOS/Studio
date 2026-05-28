import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio integration — GOTHIC TRACERY LATTICE (Video-741 1:1 parity, full).
 *
 * The full interlacing pointed-arch net from the reference, built on the
 * Arch primitive integrated in slice 130. Brick-offset rows of lancet
 * arches (each lower arch's apex rises between two arches of the row
 * above) weave the repeating ogee lattice; vertical mullions run the
 * column lines and a stone frame surrounds it. Side-by-side stitched so
 * 1:1 parity is visible.
 *
 * Beats the single-window iteration (slice 130): the actual repeating
 * lattice, ~40 bodies, still a fast deterministic build.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-tracery-lattice');
const REF = path.resolve(__dirname, '..', 'tools', '.video-thumbs', 'Video-741_f4.jpg');
const STONE = '#bcb7ad', STONE2 = '#aaa498';

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

test('Studio Integration — Gothic Tracery Lattice (Video-741 1:1 parity)', async () => {
  test.setTimeout(600000);
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

  // Lattice geometry (XY plane, viewed face-on). cell = column pitch.
  const cell = 0.03;
  const cols = 5;                       // arch columns
  const x0 = -((cols - 1) / 2) * cell;  // left column centre
  const rowY = [-0.045, -0.015, 0.015, 0.045];
  const aScale = [1.0, 2.3, 0.7];        // arch: span one cell, tall lancet

  // ════ Arch net — brick-offset rows of lancet arches ═════════════
  let arches = 0;
  for (let r = 0; r < rowY.length; r++) {
    const offset = (r % 2) * (cell / 2);  // alternate rows shift half a cell
    const n = (r % 2) ? cols - 1 : cols;
    for (let c = 0; c < n; c++) {
      const x = x0 + offset + c * cell;
      await placeBody(win, 'arch', [x, rowY[r], 0], aScale, r % 2 ? STONE2 : STONE);
      arches++;
    }
  }
  await win.screenshot({ path: path.join(OUT, '01-arch-net.png'), fullPage: false });

  // ════ Mullions — thin vertical bars on the column lines ══════════
  for (let c = 0; c < cols; c++) {
    await placeBody(win, 'cylinder', [x0 + c * cell, 0, -0.002], [0.16, 6.6, 0.16], STONE);
  }
  // ════ Frame — sill, head band, two jambs ════════════════════════
  await placeBody(win, 'cube', [0, -0.066, 0], [(cols * cell + 0.012) / 0.03, 0.3, 0.7], STONE);   // sill
  await placeBody(win, 'cube', [0, 0.066, 0], [(cols * cell + 0.012) / 0.03, 0.3, 0.7], STONE);    // head
  await placeBody(win, 'cube', [x0 - cell * 0.5, 0, 0], [0.3, 4.6, 0.7], STONE);                   // left jamb
  await placeBody(win, 'cube', [-x0 + cell * 0.5, 0, 0], [0.3, 4.6, 0.7], STONE);                  // right jamb
  // ════ Oculi — small tracery rings at the upper intersections ════
  for (const ox of [-cell, 0, cell]) {
    await placeBody(win, 'torus', [ox, 0.032, 0.003], [0.5, 0.5, 0.5], STONE2);
  }
  await win.screenshot({ path: path.join(OUT, '02-lattice-complete.png'), fullPage: false });
  const buildMs = Date.now() - t0;

  // ════ LIGHTING — soft stone daylight (accent intensities) ═══════
  const lc = (w, h) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="color"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, h);
  const li = (w, v) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="intensity"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(x)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, v);
  await tab(win, 'rendering');
  await lc(win, '#fff6ea'); await li(win, '0.22'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#e8eefc'); await li(win, '0.14'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#fff0db'); await li(win, '0.1'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);

  // ════ FRAME — face-on view of the lattice ═══════════════════════
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(0, 3, 0.95));
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
  expect(state.arches).toBeGreaterThanOrEqual(16); // the interlacing arch net
  expect(state.prim).toBeGreaterThanOrEqual(28);   // arches + mullions + frame + oculi
  expect(state.lights).toBe(3);

  // ════ Views — face-on + slight angle to show the relief ═════════
  await tab(win, 'rendering');
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(360);
  for (const az of [0, 18, -18, 30]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 5, 0.95), az);
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `04-view-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  tracery lattice: ${state.prim} bodies (${state.arches} arches), build ${(buildMs / 1000).toFixed(1)}s, side-by-side written`);

  await app.close();
});
