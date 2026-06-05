// Studio V3 — Plasticity-style subdivision-surface modeling toolkit.
//
// Exercises the op surface installed by
// frontend/src/workbenches/studio/v3/subdiv/. Because this slice
// can't touch api.js (the orchestrator wires the autoload in later),
// we load the installer manually by reading the source files,
// stripping their `import { … } from '…'` lines, and inlining them
// into a single evaluatable bundle that defines every
// `window.__studioSubdiv*` op the spec asserts.
//
// Mirrors the inline-bundle pattern from studio-v3-sculpt-deep-
// electron.spec.js — see that file for rationale.
//
// Headed, slow-motion Electron — matches the Studio remote-watch rule.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-subdiv');
const SUBDIV_DIR = path.resolve(
  __dirname, '..', 'frontend', 'src', 'workbenches', 'studio', 'v3', 'subdiv',
);

// ── inline-bundle helper ──────────────────────────────────────────────
// Reads every JS module (NOT the .jsx panel — the panel needs a real
// React+Vite pipeline and we only need to assert the op surface +
// math correctness in this spec). After stripping imports/exports, we
// emit a single IIFE that ends by calling a stub `installSubdiv()`
// derived from index.js, with the panel-related ops degraded to
// no-ops.
function buildInlineBundle() {
  const files = [
    'loopSubdiv.js',
    'crease.js',
    'surface.js',
    'cageEdit.js',
  ];

  const parts = [];
  for (const f of files) {
    let src = fs.readFileSync(path.join(SUBDIV_DIR, f), 'utf8');
    // Strip multi-line `import { … } from '…';` blocks.
    src = src.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?/gm, '');
    src = src.replace(/^\s*import\s+['"][^'"]+['"]\s*;?/gm, '');
    // Convert exports to plain declarations.
    src = src.replace(/^\s*export\s+(function|const|let|class)\b/gm, '$1');
    src = src.replace(/^\s*export\s+default\s+/gm, '/* export default */ ');
    src = src.replace(/^\s*export\s+\{[^}]*\}\s*;?/gm, '');
    parts.push(`/* ── ${f} ── */\n${src}`);
  }

  const header = `
    const THREE = window.THREE;
    if (!THREE) throw new Error('THREE not on window — viewport not mounted');
  `;

  // Hand-roll a minimal installer that mirrors index.js' op surface
  // without React or the SubdivPanel. Each op resolves the target
  // mesh by uuid (falling back to the current selection).
  const tail = `
    const _cageShown = new Map();
    function _selUuid() {
      const fn = window.__studioSelectedMesh;
      const m = (typeof fn === 'function') ? fn() : null;
      return m ? m.uuid : null;
    }
    function _by(uuid) { return uuid ? meshByUuid(uuid) : (window.__studioSelectedMesh && window.__studioSelectedMesh()); }

    window.__studioSubdivWrap = (uuid, levels) => {
      const u = uuid || _selUuid(); if (!u) return { ok: false, error: 'no mesh' };
      return wrap(u, levels == null ? DEFAULT_LEVELS : levels);
    };
    window.__studioSubdivUnwrap = (uuid) => {
      const u = uuid || _selUuid(); if (!u) return { ok: false, error: 'no mesh' };
      const r = unwrap(u); if (r && r.ok) _cageShown.delete(u); return r;
    };
    window.__studioSubdivSetLevel = (uuid, levels) => {
      const u = uuid || _selUuid(); if (!u) return { ok: false, error: 'no mesh' };
      return setLevel(u, levels);
    };
    window.__studioSubdivSetEdgeCrease = (uuid, i, j, w) => {
      const u = uuid || _selUuid(); if (!u) return { ok: false, error: 'no mesh' };
      const r = setEdgeCrease(u, Number(i), Number(j), Number(w));
      const m = _by(u);
      if (m && isWrapped(m)) {
        const lv = Number(m.userData[LEVEL_KEY]);
        setLevel(m, Number.isFinite(lv) ? lv : DEFAULT_LEVELS);
      }
      return r;
    };
    window.__studioSubdivClearCreases = (uuid) => {
      const u = uuid || _selUuid(); if (!u) return { ok: false, error: 'no mesh' };
      const r = clearCreases(u);
      const m = _by(u);
      if (m && isWrapped(m)) {
        const lv = Number(m.userData[LEVEL_KEY]);
        setLevel(m, Number.isFinite(lv) ? lv : DEFAULT_LEVELS);
      }
      return r;
    };
    window.__studioSubdivListCreases = (uuid) => {
      const u = uuid || _selUuid(); if (!u) return { ok: true, count: 0, creases: [] };
      return listCreases(u);
    };
    window.__studioSubdivSetCageVertex = (uuid, idx, xyz) => {
      const u = uuid || _selUuid(); if (!u) return { ok: false, error: 'no mesh' };
      return setCageVertex(u, Number(idx), xyz);
    };
    window.__studioSubdivNudgeCageVertex = (uuid, idx, dxyz) => {
      const u = uuid || _selUuid(); if (!u) return { ok: false, error: 'no mesh' };
      return nudgeCageVertex(u, Number(idx), dxyz);
    };
    window.__studioSubdivGetCageVertex = (uuid, idx) => {
      const u = uuid || _selUuid(); if (!u) return { ok: false, error: 'no mesh' };
      const xyz = getCageVertex(u, Number(idx));
      return xyz ? { ok: true, xyz } : { ok: false, error: 'no cage vert' };
    };
    window.__studioSubdivShowCage = (uuid, on) => {
      const u = uuid || _selUuid(); if (!u) return { ok: false, error: 'no mesh' };
      const r = showCage(u, !!on);
      if (r && r.ok) _cageShown.set(u, !!on);
      return r;
    };
    window.__studioSubdivApply = (uuid) => {
      const u = uuid || _selUuid(); if (!u) return { ok: false, error: 'no mesh' };
      const r = apply(u); if (r && r.ok) _cageShown.delete(u); return r;
    };
    window.__studioSubdivStatus = (uuid) => {
      const m = _by(uuid); if (!m) return { ok: false, error: 'no mesh' };
      const cage = getCage(m);
      const smoothVerts = m.geometry && m.geometry.attributes.position ? m.geometry.attributes.position.count : 0;
      return { ok: true, uuid: m.uuid, wrapped: isWrapped(m), cageShown: !!_cageShown.get(m.uuid),
               cageVerts: cage ? cage.vertCount : 0, smoothVerts,
               levels: cage && Number.isFinite(cage.levels) ? cage.levels : null };
    };
    // Panel ops degrade to inert OK responses for the inline bundle —
    // the real panel is wired by autoload.js inside the app.
    window.__studioSubdivPanelOpen   = () => ({ ok: true, open: true,  stub: 'inline' });
    window.__studioSubdivPanelClose  = () => ({ ok: true, open: false, stub: 'inline' });
    window.__studioSubdivPanelToggle = () => ({ ok: true, open: true,  stub: 'inline' });
    return { ok: true, installed: true };
  `;

  return `(() => {\n${header}\n${parts.join('\n')}\n${tail}\n})();`;
}

test('Studio V3 — Plasticity subdiv: wrap + level + creases + cage edit + apply', async () => {
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

  // Spawn a cube — small face count is ideal for asserting Loop math.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-spawn.png') });

  // Inline-load the subdiv installer.
  const bundle = buildInlineBundle();
  const installResult = await win.evaluate(async (code) => {
    // eslint-disable-next-line no-eval
    return eval(code);
  }, bundle);
  expect(installResult && installResult.ok).toBeTruthy();
  // eslint-disable-next-line no-console
  console.log('  install:', JSON.stringify(installResult));

  // Confirm every op is now on window.
  const ops = await win.evaluate(() => Object.keys(window).filter((k) => k.startsWith('__studioSubdiv')));
  expect(ops).toEqual(expect.arrayContaining([
    '__studioSubdivWrap', '__studioSubdivUnwrap', '__studioSubdivSetLevel',
    '__studioSubdivSetEdgeCrease', '__studioSubdivClearCreases', '__studioSubdivListCreases',
    '__studioSubdivSetCageVertex', '__studioSubdivShowCage', '__studioSubdivApply',
    '__studioSubdivStatus',
    '__studioSubdivPanelOpen', '__studioSubdivPanelClose', '__studioSubdivPanelToggle',
  ]));

  // Get the uuid of the spawned cube.
  const uuid = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return m ? m.uuid : null;
  });
  expect(uuid).toBeTruthy();

  // ── Wrap with default level 2 ──────────────────────────────────────
  const w = await win.evaluate(() => window.__studioSubdivWrap());
  expect(w.ok).toBe(true);
  expect(w.cageVerts).toBeGreaterThan(0);
  expect(w.smoothVerts).toBeGreaterThan(w.cageVerts);
  expect(w.levels).toBe(2);
  // eslint-disable-next-line no-console
  console.log('  wrap cage:', w.cageVerts, '→ smooth:', w.smoothVerts);
  await win.screenshot({ path: path.join(OUT, '01-wrap.png') });

  // Status check.
  const st1 = await win.evaluate(() => window.__studioSubdivStatus());
  expect(st1.ok).toBe(true);
  expect(st1.wrapped).toBe(true);
  expect(st1.levels).toBe(2);

  // ── Level up to 3 → smoothVerts ~4x ────────────────────────────────
  const sv2 = w.smoothVerts;
  const lvl3 = await win.evaluate(() => window.__studioSubdivSetLevel(undefined, 3));
  expect(lvl3.ok).toBe(true);
  expect(lvl3.levels).toBe(3);
  expect(lvl3.smoothVerts).toBeGreaterThan(sv2);
  // eslint-disable-next-line no-console
  console.log('  level 3 smooth verts:', lvl3.smoothVerts);
  await win.screenshot({ path: path.join(OUT, '02-level3.png') });

  // Back to 1.
  const lvl1 = await win.evaluate(() => window.__studioSubdivSetLevel(undefined, 1));
  expect(lvl1.ok).toBe(true);
  expect(lvl1.levels).toBe(1);
  await win.screenshot({ path: path.join(OUT, '03-level1.png') });

  // ── Show cage helper ───────────────────────────────────────────────
  const sc = await win.evaluate(() => window.__studioSubdivShowCage(undefined, true));
  expect(sc.ok).toBe(true);
  expect(sc.on).toBe(true);
  // Confirm a LineSegments child got added.
  const childCount = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return m ? m.children.filter((c) => c.userData && c.userData.__studioSubdivCageHelper).length : 0;
  });
  expect(childCount).toBe(1);
  await win.screenshot({ path: path.join(OUT, '04-show-cage.png') });

  // Hide cage.
  await win.evaluate(() => window.__studioSubdivShowCage(undefined, false));
  const childCountAfter = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return m ? m.children.filter((c) => c.userData && c.userData.__studioSubdivCageHelper).length : 0;
  });
  expect(childCountAfter).toBe(0);

  // ── Crease + rebuild ───────────────────────────────────────────────
  // Cube cage after weld has 8 unique verts; edge 0↔1 should always exist.
  const cre = await win.evaluate(() => window.__studioSubdivSetEdgeCrease(undefined, 0, 1, 1));
  expect(cre.ok).toBe(true);
  expect(cre.weight).toBe(1);
  expect(cre.key).toBe('0:1');

  const cl = await win.evaluate(() => window.__studioSubdivListCreases());
  expect(cl.count).toBe(1);
  expect(cl.creases[0].weight).toBe(1);
  await win.screenshot({ path: path.join(OUT, '05-crease.png') });

  // Set another crease to verify list grows.
  await win.evaluate(() => window.__studioSubdivSetEdgeCrease(undefined, 0, 2, 0.5));
  const cl2 = await win.evaluate(() => window.__studioSubdivListCreases());
  expect(cl2.count).toBe(2);

  // Remove one by setting weight 0.
  await win.evaluate(() => window.__studioSubdivSetEdgeCrease(undefined, 0, 2, 0));
  const cl3 = await win.evaluate(() => window.__studioSubdivListCreases());
  expect(cl3.count).toBe(1);

  // Clear all.
  await win.evaluate(() => window.__studioSubdivClearCreases());
  const cl4 = await win.evaluate(() => window.__studioSubdivListCreases());
  expect(cl4.count).toBe(0);

  // ── Cage vertex edit → smooth rebuilds ─────────────────────────────
  // Capture the pre-edit bounding sphere radius so we can prove the
  // smooth mesh changed shape (not just the cage).
  const before = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.geometry.computeBoundingSphere();
    return m.geometry.boundingSphere.radius;
  });
  const edit = await win.evaluate(() => window.__studioSubdivSetCageVertex(undefined, 0, [2, 2, 2]));
  expect(edit.ok).toBe(true);
  expect(edit.xyz).toEqual([2, 2, 2]);
  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.geometry.computeBoundingSphere();
    return m.geometry.boundingSphere.radius;
  });
  expect(after).toBeGreaterThan(before);
  // eslint-disable-next-line no-console
  console.log('  cage edit grew radius:', before.toFixed(3), '→', after.toFixed(3));
  await win.screenshot({ path: path.join(OUT, '06-cage-edit.png') });

  // Readback the cage vertex.
  const rb = await win.evaluate(() => window.__studioSubdivGetCageVertex(undefined, 0));
  expect(rb.ok).toBe(true);
  expect(rb.xyz).toEqual([2, 2, 2]);

  // Nudge it back via delta.
  const nudge = await win.evaluate(() => window.__studioSubdivNudgeCageVertex(undefined, 0, [-1, -1, -1]));
  expect(nudge.ok).toBe(true);
  expect(nudge.xyz).toEqual([1, 1, 1]);

  // ── Unwrap → cage restored as live geometry ────────────────────────
  const uw = await win.evaluate(() => window.__studioSubdivUnwrap());
  expect(uw.ok).toBe(true);
  expect(uw.restoredVerts).toBeGreaterThan(0);
  const st2 = await win.evaluate(() => window.__studioSubdivStatus());
  expect(st2.wrapped).toBe(false);
  await win.screenshot({ path: path.join(OUT, '07-unwrap.png') });

  // ── Re-wrap + Apply ────────────────────────────────────────────────
  const w2 = await win.evaluate(() => window.__studioSubdivWrap(undefined, 2));
  expect(w2.ok).toBe(true);
  const sm2 = w2.smoothVerts;
  const ap = await win.evaluate(() => window.__studioSubdivApply());
  expect(ap.ok).toBe(true);
  expect(ap.bakedVerts).toBe(sm2);
  // After apply: wrapped flag false; mesh keeps smoothed geometry.
  const st3 = await win.evaluate(() => window.__studioSubdivStatus());
  expect(st3.wrapped).toBe(false);
  expect(st3.smoothVerts).toBe(sm2);
  await win.screenshot({ path: path.join(OUT, '08-apply.png') });

  // ── Panel ops respond OK (stubs in inline bundle, real in app) ─────
  const po = await win.evaluate(() => window.__studioSubdivPanelOpen());
  expect(po.ok).toBe(true);
  const pc = await win.evaluate(() => window.__studioSubdivPanelClose());
  expect(pc.ok).toBe(true);
  const pt = await win.evaluate(() => window.__studioSubdivPanelToggle());
  expect(pt.ok).toBe(true);

  // ── Wrap up. ───────────────────────────────────────────────────────
  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(150);
  await app.close();
});
