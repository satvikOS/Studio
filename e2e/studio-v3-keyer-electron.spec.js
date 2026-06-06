// ArchDisc Studio V3 — compositor chroma keyer + glow e2e (slice 737).
//
// Headed Mac-Electron spec. Adds the flagship VFX compositing nodes the
// compositor was missing: a CHROMA KEYER (green/blue-screen matte +
// despill — Nuke Keylight / Fusion Primatte / OBS Chroma Key) and a
// GLOW/bloom (Nuke Glow / Blender Glare).
//
// Exercises __studioCompositor{NodeAdd,NodeConnect,NodeSetParam,
// EvaluateWith,ListKinds}:
//   • kinds list includes 'keyer' and 'glow'
//   • build image → keyer → output, push a known frame (green screen +
//     reddish subject) through, read back the output pixels
//   • green-screen pixels key to alpha ≈ 0 (transparent); subject pixels
//     stay alpha ≈ 255 (opaque) — a real matte
//   • a green-spilled subject pixel gets its green channel despilled
//   • build image → glow → output and confirm a same-size result
//   • global search surfaces the new ops
//   • camera sweep

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-keyer');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — compositor chroma keyer + glow', async () => {
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

  // ── 1) The new kinds are registered. ──────────────────────────────
  const kinds = await win.evaluate(() => window.__studioCompositorListKinds());
  expect(kinds.ok).toBe(true);
  expect(kinds.kinds).toContain('keyer');
  expect(kinds.kinds).toContain('glow');

  // ── 2) Build image → keyer → output (on a clean graph). ───────────
  const built = await win.evaluate(() => {
    window.__studioCompositorGraphDeserialize({ version: 1, nodes: [], wires: [] });
    const img = window.__studioCompositorNodeAdd('image', {});
    const key = window.__studioCompositorNodeAdd('keyer', {});
    const out = window.__studioCompositorNodeAdd('output', {});
    window.__studioCompositorNodeConnect(img.uuid, 'image', key.uuid, 'image');
    window.__studioCompositorNodeConnect(key.uuid, 'image', out.uuid, 'image');
    return { img: img.uuid, key: key.uuid, out: out.uuid };
  });
  expect(built.key).toBeTruthy();

  // ── 3) Push a known frame: left half green screen, right half subject. ──
  const src = {
    width: 4, height: 1,
    data: [
      13, 179, 26, 255,   // green screen
      13, 179, 26, 255,   // green screen
      200, 120, 90, 255,  // reddish subject
      200, 120, 90, 255,  // reddish subject
    ],
  };
  const res = await win.evaluate((s) => window.__studioCompositorEvaluateWith(s), src);
  expect(res.ok).toBe(true);
  expect(res.width).toBe(4);
  // Alpha at pixel 0 (green) should be ~0; pixel 2 (subject) ~255.
  const greenAlpha = res.data[0 * 4 + 3];
  const subjAlpha = res.data[2 * 4 + 3];
  console.log('[keyer] greenAlpha=', greenAlpha, 'subjAlpha=', subjAlpha);
  expect(greenAlpha).toBeLessThan(40);
  expect(subjAlpha).toBeGreaterThan(200);

  // ── 4) Despill: feed a green-spilled subject pixel; green pulls down. ──
  const spill = { width: 1, height: 1, data: [120, 200, 110, 255] };
  const ds = await win.evaluate((s) => window.__studioCompositorEvaluateWith(s), spill);
  expect(ds.ok).toBe(true);
  console.log('[keyer] despill green 200 →', ds.data[1]);
  expect(ds.data[1]).toBeLessThan(200); // green suppressed toward avg(R,B)=115

  // ── 5) Tune a keyer param (widen clipWhite) and re-evaluate. ───────
  const sp = await win.evaluate((u) => window.__studioCompositorNodeSetParam(u, 'despill', 0.0), built.key);
  expect(sp.ok).toBe(true);
  expect(sp.value).toBe(0.0);
  const ds2 = await win.evaluate((s) => window.__studioCompositorEvaluateWith(s), spill);
  // With despill off, the green channel is preserved.
  expect(ds2.data[1]).toBe(200);

  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-keyer.png') });

  // ── 6) Glow node: image → glow → output produces a same-size result. ──
  const glowRes = await win.evaluate(() => {
    // Reset to a clean graph so there's exactly one output node.
    window.__studioCompositorGraphDeserialize({ version: 1, nodes: [], wires: [] });
    const img = window.__studioCompositorNodeAdd('image', {});
    const gl = window.__studioCompositorNodeAdd('glow', {});
    const out = window.__studioCompositorNodeAdd('output', {});
    window.__studioCompositorNodeConnect(img.uuid, 'image', gl.uuid, 'image');
    window.__studioCompositorNodeConnect(gl.uuid, 'image', out.uuid, 'image');
    const s = { width: 3, height: 1, data: [255,255,255,255, 10,10,10,255, 10,10,10,255] };
    return window.__studioCompositorEvaluateWith(s);
  });
  expect(glowRes.ok).toBe(true);
  expect(glowRes.width).toBe(3);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-glow.png') });

  // ── 7) Global search surfaces the new compositor ops. ─────────────
  const search = await win.evaluate(() => window.__studioCommandSearch('compositor', 60));
  expect(search.ok).toBe(true);
  const names = search.hits.map((h) => h.name);
  expect(names).toContain('__studioCompositorNodeSetParam');

  // ── 8) Camera sweep. ───────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 737: keyer greenAlpha', greenAlpha, 'subjAlpha', subjAlpha, '| despill', ds.data[1]);

  await app.close();
});
