// ArchDisc Studio V3 — Substance Designer Normal/AO from Height (slice 739).
//
// Headed Mac-Electron spec. Adds the two flagship Substance-Designer
// material-builder nodes the sdesigner inventory was missing:
//   • normalfromheight — Sobel gradient over the sampled height field →
//     tangent-space normal encoded as RGB (n*0.5+0.5). Flat → (.5,.5,1).
//   • aofromheight — concave-region occlusion: 1 − (avgNeighbour − centre).
//
// Drives them through the real evaluator via __studioSDesignerApply and
// confirms registration via __studioSDesignerList:
//   • both kinds are listed
//   • strength=0 normal is exactly (0.5,0.5,1) (straight-up)
//   • at moderate strength the normal map stays blue(z)-dominant (valid)
//   • AO output stays within [0,1] and varies across the field
//   • global search surfaces a per-kind op
//   • camera sweep

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-nfh');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — Substance Designer Normal/AO from Height', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });
  // --dev may auto-open a DevTools window; app.firstWindow() can race onto
  // it. Pick the real app window (http(s)/file/localhost URL, not
  // devtools://). Poll briefly until it appears.
  let win = null;
  for (let i = 0; i < 30 && !win; i++) {
    const wins = app.windows();
    win = wins.find((w) => {
      const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
      return u && !u.startsWith('devtools://');
    }) || null;
    if (!win) { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!win) win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  win.on('console', (m) => { try { console.log('[page]', m.type(), m.text()); } catch (_) {} });
  win.on('pageerror', (e) => { try { console.log('[pageerror]', e.message); } catch (_) {} });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  let shellUp = false;
  for (let attempt = 0; attempt < 4 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1500);
    try {
      await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 40000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 30000 });

  await win.evaluate(async () => {
    if (typeof window.__studioSDesignerApply !== 'function') {
      await import('/src/workbenches/studio/v3/sdesigner/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioSDesignerApply === 'function',
    null, { timeout: 20000 });
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Both kinds registered. ─────────────────────────────────────
  const list = await win.evaluate(() => window.__studioSDesignerList());
  expect(list.ok).toBe(true);
  expect(list.kinds).toContain('normalfromheight');
  expect(list.kinds).toContain('aofromheight');

  // ── 2) strength=0 → flat straight-up normal (0.5,0.5,1). ──────────
  const flat = await win.evaluate(() =>
    window.__studioSDesignerApply('normalfromheight', { strength: 0 }, {}, { u: 0.3, v: 0.7 }));
  expect(flat.ok).toBe(true);
  console.log('[nfh] flat normal:', flat.value.map((x) => x.toFixed(3)).join(','));
  expect(Math.abs(flat.value[0] - 0.5)).toBeLessThan(1e-6);
  expect(Math.abs(flat.value[1] - 0.5)).toBeLessThan(1e-6);
  expect(Math.abs(flat.value[2] - 1.0)).toBeLessThan(1e-6);

  // ── 3) Moderate strength → normal stays blue(z)-dominant (valid map). ──
  const stats = await win.evaluate(() => {
    let blue = 0, deviated = 0; const N = 300;
    for (let i = 0; i < N; i++) {
      const u = Math.random(), v = Math.random();
      const r = window.__studioSDesignerApply('normalfromheight', { strength: 1 }, {}, { u, v });
      const c = r.value;
      if (c[2] >= c[0] && c[2] >= c[1]) blue++;
      if (Math.abs(c[0] - 0.5) > 0.02 || Math.abs(c[1] - 0.5) > 0.02) deviated++;
    }
    return { blue, deviated, N };
  });
  console.log('[nfh] blue-dominant', stats.blue + '/' + stats.N, 'deviated', stats.deviated + '/' + stats.N);
  expect(stats.blue).toBe(stats.N);        // every pixel a valid +Z normal
  expect(stats.deviated).toBeGreaterThan(stats.N * 0.5); // field has real slope
  await win.waitForTimeout(120);
  await win.screenshot({ path: path.join(OUT, '01-normal.png') });

  // ── 4) AO stays in [0,1] and varies. ─────────────────────────────
  const ao = await win.evaluate(() => {
    let lo = 1, hi = 0; const N = 300;
    for (let i = 0; i < N; i++) {
      const u = Math.random(), v = Math.random();
      const r = window.__studioSDesignerApply('aofromheight', { strength: 12 }, {}, { u, v });
      const f = r.value.fac;
      if (f < lo) lo = f; if (f > hi) hi = f;
    }
    return { lo, hi };
  });
  console.log('[aofh] AO range [', ao.lo.toFixed(3), ',', ao.hi.toFixed(3), ']');
  expect(ao.lo).toBeGreaterThanOrEqual(0);
  expect(ao.hi).toBeLessThanOrEqual(1);
  expect(ao.hi - ao.lo).toBeGreaterThan(0.03);
  await win.waitForTimeout(120);
  await win.screenshot({ path: path.join(OUT, '02-ao.png') });

  // ── 5) Global search surfaces a per-kind op. ──────────────────────
  const search = await win.evaluate(() => window.__studioCommandSearch('normal', 80));
  expect(search.ok).toBe(true);
  const hasNfh = search.hits.some((h) => /normalfromheight/i.test(h.name));
  expect(hasNfh).toBe(true);

  // ── 6) Camera sweep. ───────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 739: nfh flat (.5,.5,1) blue', stats.blue + '/' + stats.N, '| AO range ok');

  await app.close();
});
