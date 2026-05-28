import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio integration — ALLOY WHEEL (Video-66 hard-surface parity).
 *
 * A generic multi-spoke performance alloy wheel — the hard-surface RADIAL
 * discipline: tire, rim barrel, a 10-spoke star (radial-pivot array), hub,
 * brake disc, an orange brake caliper (the colour pop), and 5 lug bolts
 * (radial ring array). 20 bodies.
 *
 * Building it surfaced a tool gap (Rule 2): the existing Radial array
 * places copies on a RING (good for lug bolts) but rotates each about its
 * own origin, so it can't make spokes that radiate from the hub. A new
 * "Radial (spokes)" array mode (radial-pivot — rotate copies about the
 * part's centre axis) was integrated, then used here for the spokes.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-alloy-wheel');
const REF = path.resolve(__dirname, '..', 'tools', '.video-thumbs', 'Video-66_f4.jpg');
const PI = Math.PI;

async function tab(win, name) { const t = win.locator(`.workbench-ribbon-placeholder-tab[data-studio-discipline="${name}"]`); await t.scrollIntoViewIfNeeded(); await t.click(); await win.waitForTimeout(220); }
async function addPrim(win, kind) { await win.locator(`[data-studio-primitive="${kind}"]`).click(); await win.waitForTimeout(200); }
async function selectLast(win) {
  await win.evaluate(() => { const vp = window.__archdiscViewport; let best = null, bi = -1; vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { const m = /(\d+)$/.exec(o.name || ''); const i = m ? +m[1] : 0; if (i >= bi) { bi = i; best = o; } } }); if (best && window.__studioSelectMesh) window.__studioSelectMesh(best); });
  await win.waitForTimeout(130);
}
async function setXform(win, p, r, s) {
  await win.evaluate(({ p, r, s }) => {
    const set = (sel, v) => { if (v == null) return; const el = document.querySelector(sel); if (!el) return; const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    if (p) { set('[data-studio-selection-edit="position-x"]', p[0]); set('[data-studio-selection-edit="position-y"]', p[1]); set('[data-studio-selection-edit="position-z"]', p[2]); }
    if (r) { set('[data-studio-selection-edit="rotation-x"]', r[0]); set('[data-studio-selection-edit="rotation-y"]', r[1]); set('[data-studio-selection-edit="rotation-z"]', r[2]); }
    if (s) { set('[data-studio-selection-edit="scale-x"]', s[0]); set('[data-studio-selection-edit="scale-y"]', s[1]); set('[data-studio-selection-edit="scale-z"]', s[2]); }
  }, { p, r, s });
  await win.waitForTimeout(110);
}
async function setMat(win, hex, metal, rough) { await win.evaluate(({ h, m, r }) => { const setV = (sel, v) => { const el = document.querySelector(sel); if (!el) return; const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }; setV('[data-studio-material="color"]', h); if (m != null) setV('[data-studio-material="metalness"]', m); if (r != null) setV('[data-studio-material="roughness"]', r); }, { h: hex, m: metal, r: rough }); await win.waitForTimeout(110); }
async function setArray(win, mode, count, radius) {
  await win.evaluate(({ m, c, r }) => {
    const sel = document.querySelector('[data-studio-array="mode"]'); if (sel) { sel.value = m; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    const set = (s, v) => { if (v == null) return; const el = document.querySelector(s); if (!el) return; const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('[data-studio-array="count"]', c); if (r != null) set('[data-studio-array="radius"]', r);
  }, { m: mode, c: count, r: radius });
  await win.waitForTimeout(160);
}
async function clickAction(win, a) { const b = win.locator(`[data-studio-action="${a}"]`); await b.scrollIntoViewIfNeeded(); await b.click(); await win.waitForTimeout(220); }
async function clickRibbon(win, a) { const b = win.locator(`[data-studio-ribbon-action="${a}"]`); await b.scrollIntoViewIfNeeded(); await b.click(); await win.waitForTimeout(220); }

test('Studio Integration — Alloy Wheel (radial-pivot spokes, Video-66 parity)', async () => {
  test.setTimeout(540000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 50 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);
  await tab(win, 'modeling');

  // The wheel is built lying flat (axle = world Y) so the radial-pivot
  // array sweeps spokes around the hub in the wheel plane.

  // ════ 1. TIRE — clean black rubber torus laid flat ══════════════
  // (No weathering — a lumpy eroded torus was occluding the wheel face
  // and muddying the spoke star; a clean smooth ring lets the spokes +
  // glowing rotor read through the opening.)
  await addPrim(win, 'torus');
  await selectLast(win);
  await setXform(win, [0, 0, 0], [PI / 2, 0, 0], [3.4, 3.4, 3.4]);
  await setMat(win, '#16161b', 0.1, 0.8);

  // ════ 2. RIM BARREL — wide dark disc inside the tire ═════════════
  await addPrim(win, 'cylinder');
  await selectLast(win);
  await setXform(win, [0, 0, 0], [0, 0, 0], [2.9, 0.42, 2.9]);
  await setMat(win, '#565660', 0.85, 0.3);

  // ════ 3. SPOKES — thin crisp bars swept into a 10-spoke star ═════
  // Thin + near-black + raised clear of the rotor so each spoke reads as
  // a distinct silhouette against the bright disc behind it.
  await addPrim(win, 'cube');
  await selectLast(win);
  await setXform(win, [0, 0.011, 0.0205], [0, 0, 0], [0.085, 0.16, 1.78]); // a thin radial bar, hub -> rim
  await setMat(win, '#17171c', 0.92, 0.26);
  await setArray(win, 'radial-pivot', 10, 0);
  await clickAction(win, 'apply-array');
  await win.screenshot({ path: path.join(OUT, '01-spokes.png'), fullPage: false });

  // ════ 4. HUB — small near-black centre cap the spokes radiate from ═
  await addPrim(win, 'cylinder');
  await selectLast(win);
  await setXform(win, [0, 0.013, 0], [0, 0, 0], [0.58, 0.7, 0.58]);
  await setMat(win, '#17171c', 0.9, 0.3);

  // ════ 5. BRAKE DISC — bright silver rotor right behind the spokes ═
  await addPrim(win, 'cylinder');
  await selectLast(win);
  await setXform(win, [0, -0.001, 0], [0, 0, 0], [2.78, 0.26, 2.78]);
  await setMat(win, '#cfd3da', 0.4, 0.5);
  // Make the rotor self-lit so it stays a bright backdrop even though the
  // cinematic point lights sit low and barely reach the wheel face — the
  // near-black spokes then silhouette crisply against the glowing disc.
  await win.evaluate(() => { const el = document.querySelector('[data-studio-material="emissive"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, '1.25'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } });

  // ════ 6. BRAKE CALIPER — orange block at the rotor edge ══════════
  await addPrim(win, 'cube');
  await selectLast(win);
  await setXform(win, [0.052, -0.006, 0], [0, 0, 0], [0.5, 0.7, 1.1]);
  await setMat(win, '#c8531e', 0.4, 0.45);

  // ════ 7. LUG BOLTS — five bolts on a ring (radial ring array) ════
  await addPrim(win, 'cylinder');
  await selectLast(win);
  await setXform(win, [0, 0.014, 0.012], [0, 0, 0], [0.16, 0.5, 0.16]);
  await setMat(win, '#3a3a40', 0.95, 0.3);
  await setArray(win, 'radial', 5, 0.012);
  await clickAction(win, 'apply-array');
  await win.screenshot({ path: path.join(OUT, '02-wheel-complete.png'), fullPage: false });

  // ════ 8. LIGHTING — dark, wet, dramatic; warm rim + cool key ═════
  const lc = (w, h) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="color"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, h);
  const li = (w, v) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="intensity"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(x)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, v);
  await tab(win, 'rendering');
  await lc(win, '#cfe0ff'); await li(win, '0.3'); await clickAction(win, 'add-light');
  await lc(win, '#ffd99a'); await li(win, '0.2'); await clickAction(win, 'add-light');
  await lc(win, '#6a7280'); await li(win, '0.13'); await clickAction(win, 'add-light');
  await expect(win.locator('[data-studio-light-count]')).toHaveText('3 added');

  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(360);
  await clickAction(win, 'capture-showreel');
  await expect.poll(async () => Number(await win.locator('[data-studio-render-count]').textContent()), { timeout: 12000 }).toBeGreaterThanOrEqual(4);

  // ════ 9. POST — SSAO into the spokes + ACES + contrast ═══════════
  await tab(win, 'compositing');
  await clickRibbon(win, 'pp-ssao'); await clickRibbon(win, 'pp-tone-map'); await clickRibbon(win, 'pp-dof');
  await win.locator('[data-studio-compositing="filter"]').selectOption('contrast(180%)');
  await clickAction(win, 'post-process');
  await win.waitForTimeout(300);

  // ════ SIDE-BY-SIDE PARITY — reference | render (3/4 wheel face) ══
  await tab(win, 'rendering');
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(360);
  // Look straight down the axle: the self-lit rotor glows, the thin dark
  // spokes silhouette into a crisp star, the clean tire rings it.
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(0, 86, 1.0));
  await win.waitForTimeout(400);
  const vpRect = await win.evaluate(() => { const el = document.querySelector('.workbench-viewport'); const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
  await win.screenshot({ path: path.join(OUT, '02-render-ref-angle.png'), clip: vpRect });
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
    ctx.fillText('REFERENCE (Video-66)', 12, 28); ctx.fillText('ARCHDISC STUDIO', aw + 36, 28);
    return c.toDataURL('image/png');
  }, { refUrl: refB64, rndUrl: rndB64 });
  fs.writeFileSync(path.join(OUT, 'PARITY-side-by-side.png'), Buffer.from(composite.split(',')[1], 'base64'));

  // ════ Assertions ════════════════════════════════════════════════
  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport; const kinds = new Set(); let prim = 0, lights = 0;
    const fx = (window.__archdiscScene.userData && window.__archdiscScene.userData.studioPostFx) || {};
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { prim++; kinds.add(o.userData.archdiscStudioPrimitiveKind); } if (o.userData && o.userData.archdiscStudioLight) lights++; });
    return { prim, lights, kinds: Array.from(kinds).sort(), postFx: Object.keys(fx).sort() };
  });
  expect(state.prim).toBe(20); // tire + rim + 10 spokes + hub + rotor + caliper + 5 bolts
  expect(state.lights).toBe(3);
  expect(state.kinds).toContain('cube-array');     // radial-pivot spokes worked
  expect(state.kinds).toContain('cylinder-array'); // radial ring lug bolts worked
  expect(state.kinds).toContain('torus');          // tire
  expect(state.postFx).toEqual(['depthOfField', 'ssao', 'toneMap']);

  // ════ Headline turntable — show the spoke star + caliper ═════════
  await tab(win, 'rendering');
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(360);
  for (const az of [25, 115, 205, 295]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 38, 1.15), az);
    await win.waitForTimeout(290);
    await win.screenshot({ path: path.join(OUT, `03-turntable-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  alloy wheel: ${state.prim} bodies, kinds=[${state.kinds.join(', ')}]`);

  await app.close();
});
