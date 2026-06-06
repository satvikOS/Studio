// ArchDisc Studio V3 — compositor Transform + Crop nodes e2e (slice 738).
//
// Headed Mac-Electron spec. Adds the two reposition workhorses every VFX
// comp needs (Nuke Transform / Crop, Fusion Transform, AE position/scale):
//   • transform — inverse-mapped, BILINEARLY sampled translate/rotate/scale
//     about the image centre; out-of-source = transparent.
//   • crop — keep a rect (l/t/r/b insets), outside → transparent.
//
// Verifies through the real node graph via __studioCompositorEvaluateWith:
//   • a single bright pixel translated tx=+1 lands one column right
//   • crop(left=1,right=1) makes the edge columns transparent, keeps centre
//   • scale=2 about centre keeps the centre bright (bilinear neighbours fill)
//   • kinds list + global search surface the new nodes
//   • camera sweep

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-xform');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — compositor transform + crop', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });
  // --dev may auto-open a DevTools window; app.firstWindow() can race onto
  // it. Pick the real app window (url() not devtools://).
  let win = null;
  for (let i = 0; i < 30 && !win; i++) {
    win = app.windows().find((w) => {
      const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
      return u && !u.startsWith('devtools://');
    }) || null;
    if (!win) { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!win) win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
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
    if (typeof window.__studioCompositorNodeAdd !== 'function') {
      await import('/src/workbenches/studio/v3/compositor/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioCompositorNodeAdd === 'function',
    null, { timeout: 20000 });
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Kinds registered. ──────────────────────────────────────────
  const kinds = await win.evaluate(() => window.__studioCompositorListKinds());
  expect(kinds.ok).toBe(true);
  expect(kinds.kinds).toContain('transform');
  expect(kinds.kinds).toContain('crop');

  // 5×1 source: a single white pixel at column 2, rest black-opaque.
  const src = {
    width: 5, height: 1,
    data: [
      0,0,0,255,  0,0,0,255,  255,255,255,255,  0,0,0,255,  0,0,0,255,
    ],
  };

  // ── 2) Transform translate tx=+1 → white moves to column 3. ───────
  const tr = await win.evaluate((s) => {
    window.__studioCompositorGraphDeserialize({ version: 1, nodes: [], wires: [] });
    const img = window.__studioCompositorNodeAdd('image', {});
    const xf = window.__studioCompositorNodeAdd('transform', { tx: 1 });
    const out = window.__studioCompositorNodeAdd('output', {});
    window.__studioCompositorNodeConnect(img.uuid, 'image', xf.uuid, 'image');
    window.__studioCompositorNodeConnect(xf.uuid, 'image', out.uuid, 'image');
    return { uuid: xf.uuid, res: window.__studioCompositorEvaluateWith(s) };
  }, src);
  expect(tr.res.ok).toBe(true);
  let brightCol = -1, bv = -1;
  for (let x = 0; x < 5; x++) { const v = tr.res.data[x * 4]; if (v > bv) { bv = v; brightCol = x; } }
  console.log('[transform] brightest column after tx=1:', brightCol);
  expect(brightCol).toBe(3);
  await win.waitForTimeout(120);
  await win.screenshot({ path: path.join(OUT, '01-transform.png') });

  // ── 3) Scale=2 about centre keeps the centre column bright. ───────
  const sc = await win.evaluate((u) => {
    window.__studioCompositorNodeSetParam(u, 'tx', 0);
    window.__studioCompositorNodeSetParam(u, 'scale', 2);
    return true;
  }, tr.uuid);
  expect(sc).toBe(true);
  const scRes = await win.evaluate((s) => window.__studioCompositorEvaluateWith(s), src);
  console.log('[transform] scale2 centre val:', scRes.data[2 * 4]);
  expect(scRes.data[2 * 4]).toBeGreaterThan(200);

  // ── 4) Crop(left=1,right=1) → edge columns transparent, centre kept. ──
  const cr = await win.evaluate((s) => {
    window.__studioCompositorGraphDeserialize({ version: 1, nodes: [], wires: [] });
    const img = window.__studioCompositorNodeAdd('image', {});
    const cp = window.__studioCompositorNodeAdd('crop', { left: 1, right: 1 });
    const out = window.__studioCompositorNodeAdd('output', {});
    window.__studioCompositorNodeConnect(img.uuid, 'image', cp.uuid, 'image');
    window.__studioCompositorNodeConnect(cp.uuid, 'image', out.uuid, 'image');
    return window.__studioCompositorEvaluateWith(s);
  }, src);
  expect(cr.ok).toBe(true);
  console.log('[crop] alpha cols 0,2,4:', cr.data[0 * 4 + 3], cr.data[2 * 4 + 3], cr.data[4 * 4 + 3]);
  expect(cr.data[0 * 4 + 3]).toBe(0);
  expect(cr.data[2 * 4 + 3]).toBe(255);
  expect(cr.data[4 * 4 + 3]).toBe(0);
  await win.waitForTimeout(120);
  await win.screenshot({ path: path.join(OUT, '02-crop.png') });

  // ── 5) Global search surfaces the compositor add op. ──────────────
  const search = await win.evaluate(() => window.__studioCommandSearch('compositor', 60));
  expect(search.ok).toBe(true);
  expect(search.hits.map((h) => h.name)).toContain('__studioCompositorNodeAdd');

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
  console.log('  slice 738: transform brightCol', brightCol, '| crop edges transparent, centre kept');

  await app.close();
});
