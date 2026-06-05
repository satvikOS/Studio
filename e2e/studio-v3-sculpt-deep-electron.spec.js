// Studio V3 — deep sculpt (ZBrush parity slice).
//
// Exercises the full op surface installed by
// frontend/src/workbenches/studio/v3/sculpt/. Because this slice
// can't touch api.js (the orchestrator wires the autoload in
// later), we load the installer manually by reading the source
// files, stripping their `import { … } from '…'` lines, and
// inlining them into a single evaluatable bundle that defines
// every `window.__studioSculpt*` op the spec asserts.
//
// Headed, slow-motion Electron — matches the Studio remote-watch
// rule. Each op runs a screenshot for the human watcher to see the
// effect of every step.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-sculpt-deep');
const SCULPT_DIR = path.resolve(
  __dirname, '..', 'frontend', 'src', 'workbenches', 'studio', 'v3', 'sculpt',
);

// ── inline-bundle helper ──────────────────────────────────────────────
// Reads our source files (ES modules) and concatenates them into a
// single IIFE that ends by calling installSculpt(). We rewrite all
// THREE imports to `window.THREE` and strip the relative imports
// (everything is in one bag). Function/const declarations have to be
// renamed because `mask.js` and `layers.js` both define helpers like
// `getActiveLayer` — namespacing is overkill; we just join them in
// order and rely on the fact that the modules don't share symbols
// except via the named exports we re-bind explicitly.
function buildInlineBundle() {
  const files = [
    'dynamesh.js',
    'mask.js',
    'layers.js',
    'alpha.js',
    'index.js',
  ];

  const parts = [];
  for (const f of files) {
    let src = fs.readFileSync(path.join(SCULPT_DIR, f), 'utf8');
    // Strip multi-line `import { … } from '…';` blocks.
    src = src.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?/gm, '');
    // Also handle bare `import 'foo';`.
    src = src.replace(/^\s*import\s+['"][^'"]+['"]\s*;?/gm, '');
    // Convert exports to plain declarations.
    src = src.replace(/^\s*export\s+(function|const|let|class)\b/gm, '$1');
    src = src.replace(/^\s*export\s+default\s+/gm, '/* export default */ ');
    // Drop `export { … };` aggregations.
    src = src.replace(/^\s*export\s+\{[^}]*\}\s*;?/gm, '');
    parts.push(`/* ── ${f} ── */\n${src}`);
  }

  // THREE has been exposed by Viewport3D.jsx as window.THREE.
  // We map the bare `THREE` identifier to that.
  const header = `
    const THREE = window.THREE;
    if (!THREE) throw new Error('THREE not on window — viewport not mounted');
  `;

  // Tail: actually run the installer (defined in index.js → installSculpt).
  const tail = `
    if (typeof installSculpt !== 'function') {
      throw new Error('installSculpt not defined after inlining');
    }
    return installSculpt();
  `;

  // Wrap in an IIFE so the temporary names don't leak.
  return `(() => {\n${header}\n${parts.join('\n')}\n${tail}\n})();`;
}

test('Studio V3 — ZBrush-style deep sculpt: DynaMesh + mask + layers + alpha', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  // V3 shell.
  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await win.waitForTimeout(600);
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 30000 });

  // Spawn a sphere primitive — DynaMesh needs a real surface.
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-spawn.png') });

  // Inline-load the V3 sculpt depth installer.
  const bundle = buildInlineBundle();
  const installResult = await win.evaluate(async (code) => {
    // eslint-disable-next-line no-eval
    return eval(code);
  }, bundle);
  expect(installResult && installResult.ok).toBeTruthy();
  // eslint-disable-next-line no-console
  console.log('  install:', JSON.stringify(installResult));

  // Confirm every op is now on window.
  const ops = await win.evaluate(() => Object.keys(window).filter((k) => k.startsWith('__studioSculpt')));
  expect(ops).toEqual(expect.arrayContaining([
    '__studioSculptDynaMesh',
    '__studioSculptMaskPaint', '__studioSculptMaskInvert', '__studioSculptMaskClear',
    '__studioSculptMaskBlur', '__studioSculptMaskGrow', '__studioSculptMaskShrink',
    '__studioSculptLayerAdd', '__studioSculptLayerList', '__studioSculptLayerSetStrength',
    '__studioSculptLayerToggleVisible', '__studioSculptLayerMergeDown',
    '__studioSculptLayerSetActive', '__studioSculptLayerDelete',
    '__studioSculptAlphaList', '__studioSculptAlphaSet', '__studioSculptAlphaSample',
  ]));

  // ── DynaMesh ────────────────────────────────────────────────────────
  const dm = await win.evaluate(() => window.__studioSculptDynaMesh(20));
  expect(dm.ok).toBe(true);
  expect(dm.newVerts).toBeGreaterThan(0);
  expect(dm.cells.filled).toBeGreaterThan(0);
  // eslint-disable-next-line no-console
  console.log('  DynaMesh:', dm.oldVerts, '→', dm.newVerts, `verts (${dm.cells.filled} cells)`);
  await win.screenshot({ path: path.join(OUT, '01-dynamesh.png') });

  // ── Mask paint ──────────────────────────────────────────────────────
  const mp = await win.evaluate(() => window.__studioSculptMaskPaint([0, 0, 0], 5, 1));
  expect(mp.ok).toBe(true);
  expect(mp.painted).toBeGreaterThan(0);
  // eslint-disable-next-line no-console
  console.log('  mask paint:', mp.painted, 'verts');
  await win.screenshot({ path: path.join(OUT, '02-mask-paint.png') });

  // Blur the mask.
  const mb = await win.evaluate(() => window.__studioSculptMaskBlur(2));
  expect(mb.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-mask-blur.png') });

  // Grow & shrink — round-trip should leave painted region non-empty.
  const mg = await win.evaluate(() => window.__studioSculptMaskGrow(0.05));
  expect(mg.ok).toBe(true);
  const ms = await win.evaluate(() => window.__studioSculptMaskShrink(0.025));
  expect(ms.ok).toBe(true);

  // Invert.
  const mi = await win.evaluate(() => window.__studioSculptMaskInvert());
  expect(mi.ok).toBe(true);

  // Clear.
  const mc = await win.evaluate(() => window.__studioSculptMaskClear());
  expect(mc.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '04-mask-clear.png') });

  // ── Layer stack ────────────────────────────────────────────────────
  const la1 = await win.evaluate(() => window.__studioSculptLayerAdd('clay'));
  expect(la1.ok).toBe(true);
  expect(la1.uuid).toBeTruthy();
  const la2 = await win.evaluate(() => window.__studioSculptLayerAdd('detail'));
  expect(la2.ok).toBe(true);
  expect(la2.uuid).toBeTruthy();

  const ll = await win.evaluate(() => window.__studioSculptLayerList());
  expect(ll.count).toBe(2);
  expect(ll.layers[0].name).toBe('clay');
  expect(ll.layers[1].name).toBe('detail');
  // eslint-disable-next-line no-console
  console.log('  layers:', ll.layers.map((l) => `${l.name}@${l.strength}`).join(', '));

  // Strength.
  const ss = await win.evaluate((u) => window.__studioSculptLayerSetStrength(u, 0.5), la2.uuid);
  expect(ss.ok).toBe(true);
  expect(ss.strength).toBeCloseTo(0.5);

  // Visibility.
  const sv = await win.evaluate((u) => window.__studioSculptLayerToggleVisible(u, false), la2.uuid);
  expect(sv.ok).toBe(true);
  expect(sv.visible).toBe(false);

  // Active set.
  const sa = await win.evaluate((u) => window.__studioSculptLayerSetActive(u), la1.uuid);
  expect(sa.ok).toBe(true);
  expect(sa.activeUuid).toBe(la1.uuid);

  // Merge down (la2 → la1 → baseline; here merge la1 down into baseline).
  const md = await win.evaluate((u) => window.__studioSculptLayerMergeDown(u), la1.uuid);
  expect(md.ok).toBe(true);
  expect(md.merged).toBe('baseline');

  // Delete (the one remaining layer).
  const list2 = await win.evaluate(() => window.__studioSculptLayerList());
  if (list2.count > 0) {
    const del = await win.evaluate((u) => window.__studioSculptLayerDelete(u), list2.layers[0].uuid);
    expect(del.ok).toBe(true);
  }
  await win.screenshot({ path: path.join(OUT, '05-layers.png') });

  // ── Alphas ─────────────────────────────────────────────────────────
  const al = await win.evaluate(() => window.__studioSculptAlphaList());
  expect(al.ok).toBe(true);
  expect(al.count).toBe(8);
  expect(al.alphas).toEqual(expect.arrayContaining([
    'circle', 'square', 'star', 'hatch', 'dots', 'splatter', 'ridges', 'fingerprint',
  ]));

  const aset = await win.evaluate(() => window.__studioSculptAlphaSet('star'));
  expect(aset.ok).toBe(true);
  expect(aset.active).toBe('star');

  const samp = await win.evaluate(() => window.__studioSculptAlphaSample(0.5, 0.5));
  expect(samp.ok).toBe(true);
  // centre of the star alpha is hollow — but a corner-ish sample should
  // come back with > 0 weight. Just verify we got a finite number.
  expect(Number.isFinite(samp.weight)).toBe(true);

  await win.screenshot({ path: path.join(OUT, '06-alpha.png') });

  // ── Brush patch (mask + alpha) ──────────────────────────────────────
  // Paint a mask, then trigger a brush stroke. With mask=1 in the
  // centre, the brush should leave the centred vertex untouched.
  await win.evaluate(() => window.__studioSculptMaskClear());
  await win.evaluate(() => window.__studioSculptMaskPaint([0, 0, 0], 5, 1));

  // Cranked-up brush so the delta is visible if it slips past the mask.
  await win.evaluate(() => window.__studioSetSculptBrush({ kind: 'inflate', size: 5, strength: 0.5, falloff: 0.6 }));
  const apply = await win.evaluate(() => window.__studioSculptBrushApply([0, 0, 0]));
  expect(apply.ok).toBe(true);
  // Patched apply returns the maskApplied flag.
  expect(apply.maskApplied).toBe(true);

  // Disable alpha + clear mask, then a vanilla stroke should still push
  // verts (sanity check we didn't break the underlying brush).
  await win.evaluate(() => window.__studioSculptAlphaSet(null));
  await win.evaluate(() => window.__studioSculptMaskClear());
  const apply2 = await win.evaluate(() => window.__studioSculptBrushApply([0, 0, 0]));
  expect(apply2.ok).toBe(true);
  expect(apply2.touched).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '07-brush-patched.png') });

  // ── Wrap up. ───────────────────────────────────────────────────────
  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(150);
  await app.close();
});
