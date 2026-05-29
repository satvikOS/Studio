import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio integration — GOTHIC RIB VAULT CEILING.
 *
 * A creative extension of the Video-741 gothic discipline using the new
 * Arch + Ogee primitives (slices 130/132) plus the radial-pivot array
 * (slice 119): a quadripartite vault bay — four corner piers, two pointed
 * OGEE diagonal ribs crossing at the crown, four ARCH wall ribs framing
 * the bay, a radial-pivot fan of tierceron ribs at the crown, and a
 * central boss. Proven with multi-angle captures.
 *
 * Demonstrates the new architectural vocabulary composing into a real 3D
 * vault, not a flat panel.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-integration-rib-vault');
const PI = Math.PI;
const STONE = '#bcb7ad', STONE2 = '#a9a399', STONE3 = '#cac4ba';

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
async function setArray(win, mode, count, radius) {
  await win.evaluate(({ m, c, r }) => {
    const sel = document.querySelector('[data-studio-array="mode"]'); if (sel) { sel.value = m; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    const set = (s, v) => { if (v == null) return; const el = document.querySelector(s); if (!el) return; const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('[data-studio-array="count"]', c); if (r != null) set('[data-studio-array="radius"]', r);
  }, { m: mode, c: count, r: radius });
  await win.waitForTimeout(160);
}
async function clickAction(win, a) { const b = win.locator(`[data-studio-action="${a}"]`); await b.scrollIntoViewIfNeeded(); await b.click(); await win.waitForTimeout(220); }

test('Studio Integration — Gothic Rib Vault Ceiling (arch + ogee + radial-pivot)', async () => {
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

  // Square bay: corners at (+/-a, *, +/-a), springing line y=0, crown y~+0.05.
  const a = 0.05;

  // ════ 1. FOUR CORNER PIERS — rise to the springing line ══════════
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    await placeBody(win, 'cylinder', [sx * a, -0.026, sz * a], [0.42, 1.75, 0.42], STONE);
  }
  // ════ 2. TWO POINTED OGEE DIAGONAL RIBS crossing at the crown ════
  await placeBody(win, 'ogee', [0, 0.004, 0], [5.0, 2.4, 0.6], STONE2, [0, PI / 4, 0]);
  await placeBody(win, 'ogee', [0, 0.004, 0], [5.0, 2.4, 0.6], STONE2, [0, -PI / 4, 0]);
  // ════ 3. FOUR ARCH WALL RIBS framing the bay edges ═══════════════
  await placeBody(win, 'arch', [0, 0.002, a], [3.5, 2.0, 0.55], STONE);   // front
  await placeBody(win, 'arch', [0, 0.002, -a], [3.5, 2.0, 0.55], STONE);  // back
  await placeBody(win, 'arch', [a, 0.002, 0], [3.5, 2.0, 0.55], STONE, [0, PI / 2, 0]);   // right
  await placeBody(win, 'arch', [-a, 0.002, 0], [3.5, 2.0, 0.55], STONE, [0, PI / 2, 0]);  // left
  await win.screenshot({ path: path.join(OUT, '01-ribs.png'), fullPage: false });

  // ════ 4. CROWN FAN — a tierceron rib swept radial-pivot x8 ═══════
  await placeBody(win, 'arch', [0, 0.028, 0.016], [1.4, 1.1, 0.45], STONE3);
  await setArray(win, 'radial-pivot', 8, 0);
  await clickAction(win, 'apply-array');
  // ════ 5. CENTRAL BOSS at the crown ═══════════════════════════════
  await placeBody(win, 'sphere', [0, 0.05, 0], [0.7, 0.7, 0.7], STONE3);
  await win.screenshot({ path: path.join(OUT, '02-vault-complete.png'), fullPage: false });
  const buildMs = Date.now() - t0;

  // ════ LIGHTING — soft stone interior (accent intensities) ═══════
  const lc = (w, h) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="color"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, h);
  const li = (w, v) => w.evaluate((x) => { const el = document.querySelector('[data-studio-lighting="intensity"]'); if (el) { const S = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; S.call(el, String(x)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }, v);
  await tab(win, 'rendering');
  await lc(win, '#fff4e2'); await li(win, '0.2'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#e6ecf8'); await li(win, '0.13'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);
  await lc(win, '#ffe7c8'); await li(win, '0.1'); await win.locator('[data-studio-action="add-light"]').click(); await win.waitForTimeout(110);

  // ════ Assertions ════════════════════════════════════════════════
  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport; let prim = 0, lights = 0, ogee = 0, arch = 0;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitive) { prim++; const k = o.userData.archdiscStudioPrimitiveKind || ''; if (k === 'ogee') ogee++; if (k.indexOf('arch') === 0) arch++; } if (o.userData && o.userData.archdiscStudioLight) lights++; });
    return { prim, lights, ogee, arch };
  });
  expect(state.lights).toBe(3);
  expect(state.ogee).toBe(2);                  // two diagonal ogee ribs
  expect(state.arch).toBeGreaterThanOrEqual(11); // 4 wall ribs + 8 fan ribs (incl. clones)
  expect(state.prim).toBeGreaterThanOrEqual(18);

  // ════ Multi-angle showcase — the vault from below + around ═══════
  await tab(win, 'rendering');
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);
  const shots = [[30, 14], [30, 60], [120, 22], [210, 18]];
  for (let i = 0; i < shots.length; i++) {
    await win.evaluate(([az, el]) => window.__archdiscOrbitView && window.__archdiscOrbitView(az, el, 1.0), shots[i]);
    await win.waitForTimeout(300);
    await win.screenshot({ path: path.join(OUT, `03-view-${i}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  rib vault: ${state.prim} bodies (${state.ogee} ogee + ${state.arch} arch ribs), build ${(buildMs / 1000).toFixed(1)}s`);

  await app.close();
});
