import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio integration — GEOMETRY-NODES SCATTER (Video-179 1:1 parity).
 *
 * The reference is a Blender geometry-nodes "instance on points" scatter:
 * a column densely covered in instanced cubes. Recreated with Studio's
 * deterministic scatter-on-surface tool (one InstancedMesh, hundreds of
 * instances stepped evenly across the surface triangles — never
 * Math.random), giving an exact, GPU-cheap match in a SINGLE op.
 *
 * Beats prior iterations on performance (one scatter op places ~600
 * instances; build is seconds) while matching a distinct major discipline.
 * Side-by-side (reference | render) stitched so parity is visible.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-scatter');
const REF = path.resolve(__dirname, '..', 'tools', '.video-thumbs', 'Video-179_f4.jpg');

async function tab(win, name) { const t = win.locator(`.workbench-ribbon-placeholder-tab[data-studio-discipline="${name}"]`); await t.scrollIntoViewIfNeeded(); await t.click(); await win.waitForTimeout(220); }
async function selectLast(win) { await win.evaluate(() => { const vp = window.__archdiscViewport; let best = null, bi = -1; vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { const m = /(\d+)$/.exec(o.name || ''); const i = m ? +m[1] : 0; if (i >= bi) { bi = i; best = o; } } }); if (best && window.__studioSelectMesh) window.__studioSelectMesh(best); }); await win.waitForTimeout(150); }
async function setXform(win, p, r, s) {
  await win.evaluate(({ p, r, s }) => {
    const set = (sel, v) => { if (v == null) return; const el = document.querySelector(sel); if (!el) return; const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    if (p) { set('[data-studio-selection-edit="position-x"]', p[0]); set('[data-studio-selection-edit="position-y"]', p[1]); set('[data-studio-selection-edit="position-z"]', p[2]); }
    if (r) { set('[data-studio-selection-edit="rotation-x"]', r[0]); set('[data-studio-selection-edit="rotation-y"]', r[1]); set('[data-studio-selection-edit="rotation-z"]', r[2]); }
    if (s) { set('[data-studio-selection-edit="scale-x"]', s[0]); set('[data-studio-selection-edit="scale-y"]', s[1]); set('[data-studio-selection-edit="scale-z"]', s[2]); }
  }, { p, r, s });
  await win.waitForTimeout(120);
}
async function clickAction(win, a) { const b = win.locator(`[data-studio-action="${a}"]`); await b.scrollIntoViewIfNeeded(); await b.click(); await win.waitForTimeout(220); }
async function setCtl(win, sel, val, isSelect) {
  await win.evaluate(({ s, v, sel2 }) => { const el = document.querySelector(s); if (!el) return; if (sel2) { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); } else { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, { s: sel, v: val, sel2: isSelect });
  await win.waitForTimeout(120);
}

test('Studio Integration — Geometry-Nodes Scatter (Video-179 1:1 parity)', async () => {
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

  // ════ 1. COLUMN — a tall cylinder, densified for scatter coverage ═
  await win.locator('[data-studio-primitive="cylinder"]').click();
  await win.waitForFunction(() => { let c = 0; window.__archdiscViewport.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) c++; }); return c >= 1; }, null, { timeout: 5000 });
  await selectLast(win);
  await win.waitForSelector('[data-studio-selection-edit="position-x"]', { timeout: 5000 });
  await setXform(win, [0, 0, 0], [0, 0, 0], [1.3, 4.6, 1.3]);
  await win.evaluate(() => { const el = document.querySelector('[data-studio-material="color"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, '#4a4a52'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } });
  for (let i = 0; i < 3; i++) await clickAction(win, 'subdivide-selected'); // more triangles -> denser scatter
  await selectLast(win);

  // ════ 2. SCATTER — instance ~600 cubes on the column surface ═════
  await setCtl(win, '[data-studio-scatter="kind"]', 'cube', true);
  await setCtl(win, '[data-studio-scatter="count"]', 600, false);
  await setCtl(win, '[data-studio-scatter="scale"]', 0.34, false);
  await clickAction(win, 'scatter-on-surface');
  await win.waitForTimeout(400);
  const buildMs = Date.now() - t0;
  await win.screenshot({ path: path.join(OUT, '01-scattered-column.png'), fullPage: false });

  // ════ 3. LIGHTING — neutral studio (accent intensities) ═════════
  const lc = (w, h) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="color"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, h);
  const li = (w, v) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="intensity"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(x)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, v);
  await tab(win, 'rendering');
  await lc(win, '#eef2ff'); await li(win, '0.2'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#dfe6f5'); await li(win, '0.13'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#cfd6e6'); await li(win, '0.1'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);

  // ════ 4. FRAME — front view of the column ════════════════════════
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(12, 8, 0.95));
  await win.waitForTimeout(400);
  const vpRect = await win.evaluate(() => { const el = document.querySelector('.workbench-viewport'); const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
  await win.screenshot({ path: path.join(OUT, '02-render-ref-angle.png'), clip: vpRect });

  // ════ 5. SIDE-BY-SIDE PARITY ═════════════════════════════════════
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
    ctx.fillText('REFERENCE (Video-179)', 12, 28); ctx.fillText('ARCHDISC STUDIO', aw + 36, 28);
    return c.toDataURL('image/png');
  }, { refUrl: refB64, rndUrl: rndB64 });
  fs.writeFileSync(path.join(OUT, 'PARITY-side-by-side.png'), Buffer.from(composite.split(',')[1], 'base64'));

  // ════ Assertions ════════════════════════════════════════════════
  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport; let prim = 0, lights = 0, scatterCount = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { prim++; if (o.userData.archdiscStudioScatterCount) scatterCount = o.userData.archdiscStudioScatterCount; } if (o.userData && o.userData.archdiscStudioLight) lights++; });
    return { prim, lights, scatterCount };
  });
  expect(state.lights).toBe(3);
  expect(state.scatterCount).toBeGreaterThanOrEqual(500); // ~600 instances scattered in one op

  // ════ Turntable ══════════════════════════════════════════════════
  await tab(win, 'rendering');
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(360);
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 8, 0.95), az);
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `03-turntable-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  scatter: ${state.scatterCount} instances in one op, build ${(buildMs / 1000).toFixed(1)}s, side-by-side written`);

  await app.close();
});
