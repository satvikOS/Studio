// Studio V3 — 25+ sculpt brushes (ZBrush / Blender parity slice).
//
// Exercises every brush installed by
// frontend/src/workbenches/studio/v3/sculptbrushes/. Because this
// slice can't touch api.js (the orchestrator wires the autoload in
// a later slice), we load the installer manually by reading the
// source files, stripping their `import { … } from '…'` lines, and
// inlining them into a single evaluatable bundle that defines every
// `window.__studioSculptBrush<Name>` op the spec asserts.
//
// Headed, slow-motion Electron — matches the Studio remote-watch
// rule. Each brush runs a screenshot so the human watcher can see
// every stroke land on the mesh.
//
// Subject is a heavily-subdivided cube — 32×32 per face = ~6 k
// verts — so every brush has plenty of vertices in its radius to
// actually move.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-sculpt-brushes');
const BRUSH_DIR = path.resolve(
  __dirname, '..', 'frontend', 'src', 'workbenches', 'studio', 'v3', 'sculptbrushes',
);

// Inline-load the brushes bundle (`brushes.js` + `index.js`).
function buildInlineBundle() {
  const files = ['brushes.js', 'index.js'];
  const parts = [];
  for (const f of files) {
    let src = fs.readFileSync(path.join(BRUSH_DIR, f), 'utf8');
    src = src.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?/gm, '');
    src = src.replace(/^\s*import\s+['"][^'"]+['"]\s*;?/gm, '');
    src = src.replace(/^\s*export\s+(function|const|let|class)\b/gm, '$1');
    src = src.replace(/^\s*export\s+default\s+/gm, '/* export default */ ');
    src = src.replace(/^\s*export\s+\{[^}]*\}\s*;?/gm, '');
    parts.push(`/* ── ${f} ── */\n${src}`);
  }
  const header = `
    const THREE = window.THREE;
    if (!THREE) throw new Error('THREE not on window — viewport not mounted');
  `;
  const tail = `
    if (typeof installSculptBrushes !== 'function') {
      throw new Error('installSculptBrushes not defined after inlining');
    }
    return installSculptBrushes();
  `;
  return `(() => {\n${header}\n${parts.join('\n')}\n${tail}\n})();`;
}

// Names must match the BRUSHES table order in brushes.js.
const ALL_BRUSHES = [
  'Clay', 'ClayStrips', 'Crease', 'Scrape', 'Fill',
  'Pinch', 'Inflate', 'Magnify', 'Polish', 'Flatten',
  'SnakeHook', 'Grab', 'Thumb', 'Nudge', 'Rotate',
  'Twist', 'Smooth', 'Layer', 'DrawSharp', 'DrawSmooth',
  'Bump', 'Slash', 'Brush', 'Mask', 'Wax',
];

test('Studio V3 — 25+ sculpt brushes: ZBrush / Blender parity', async () => {
  test.setTimeout(360000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 120,
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
  await win.waitForTimeout(500);
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 30000 });

  // Build a dense, subdivided cube — every brush needs enough verts in
  // its radius to actually have something to move. The default Studio
  // cube has 24 vertices (6 faces × 4 corners), which would let only a
  // handful of brushes touch anything.
  await win.evaluate(() => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    // 32×32 per face — about 6 k verts after Three's de-dup.
    const geo = new THREE.BoxGeometry(2, 2, 2, 32, 32, 32);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc4d4e6, roughness: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'sculpt-target';
    mesh.userData = { archdiscStudioPrimitive: true, archdiscStudioPrimitiveKind: 'box' };
    scene.add(mesh);
    if (window.__studioSelectMesh) window.__studioSelectMesh(mesh);
    window.__sculptTestMesh = mesh;
  });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-spawn.png') });

  // Inline-load the brushes installer.
  const bundle = buildInlineBundle();
  const installResult = await win.evaluate(async (code) => {
    // eslint-disable-next-line no-eval
    return eval(code);
  }, bundle);
  expect(installResult && installResult.ok).toBeTruthy();
  expect(installResult.brushes).toBeGreaterThanOrEqual(25);
  // eslint-disable-next-line no-console
  console.log('  install:', installResult.brushes, 'brushes ·', installResult.ops, 'ops');

  // Sanity: every brush op landed on window.
  const opsOnWindow = await win.evaluate(() => Object.keys(window).filter((k) => k.startsWith('__studioSculptBrush')));
  for (const name of ALL_BRUSHES) {
    expect(opsOnWindow).toContain('__studioSculptBrush' + name);
  }
  // Utility ops too.
  expect(opsOnWindow).toEqual(expect.arrayContaining([
    '__studioSculptBrushList',
    '__studioSculptBrushSetActive',
    '__studioSculptBrushGetActive',
    '__studioSculptBrushApplyActive',
    '__studioSculptBrushSetRadius',
  ]));

  // Sanity: the list op enumerates all 25 brushes.
  const list = await win.evaluate(() => window.__studioSculptBrushList());
  expect(list.ok).toBe(true);
  expect(list.count).toBeGreaterThanOrEqual(25);
  expect(list.names).toEqual(expect.arrayContaining(ALL_BRUSHES));

  // SetRadius — confirms the util.
  const setR = await win.evaluate(() => window.__studioSculptBrushSetRadius(0.35));
  expect(setR.ok).toBe(true);
  expect(setR.radius).toBeCloseTo(0.35);

  // For each brush, snapshot position array → invoke → verify mesh
  // changed. Mask brush is the exception: it paints into the mask
  // (not into vertex positions) — verify mesh.userData mask grew.
  let runIdx = 1;
  for (const name of ALL_BRUSHES) {
    // Reset the cube to a clean state per brush so geometry doesn't
    // accumulate into degenerate shapes the next brush can't process.
    await win.evaluate(() => {
      const THREE = window.THREE;
      const m = window.__sculptTestMesh;
      if (m && m.geometry && m.geometry.dispose) m.geometry.dispose();
      m.geometry = new THREE.BoxGeometry(2, 2, 2, 32, 32, 32);
      m.geometry.computeVertexNormals();
      if (m.userData) {
        delete m.userData.archdiscStudioSculptMask;
        delete m.userData.archdiscStudioSculptLayers;
        delete m.userData.archdiscStudioSculptBaseline;
      }
    });

    // Pre-stroke snapshot.
    const before = await win.evaluate(() => {
      const m = window.__sculptTestMesh;
      return Array.from(m.geometry.attributes.position.array);
    });
    const beforeMaskLen = await win.evaluate(() => {
      const m = window.__sculptTestMesh;
      const mk = m.userData && m.userData.archdiscStudioSculptMask;
      return mk ? mk.length : 0;
    });

    // Apply at the +X face centre — that's a vertex-dense region.
    // SnakeHook / Grab / Nudge / Thumb / Slash / Rotate / Twist take
    // direction/axis params; pass sensible defaults.
    const result = await win.evaluate(([brushName]) => {
      const op = window['__studioSculptBrush' + brushName];
      if (typeof op !== 'function') return { ok: false, error: 'missing op' };
      const point = [1.0, 0, 0]; // +X face surface
      const radius = 0.6;
      const strength = 0.7;
      const opts = {
        direction: [0, 1, 0],
        axis: [1, 0, 0],
        target: [1.4, 0.4, 0],
        alpha: 'circle',
        variance: 0.3,
        offset: [0.2, 0.3, 0.1],
      };
      return op(point, radius, strength, opts);
    }, [name]);

    expect(result.ok).toBe(true);

    // Mask brush: assert the mask array grew (or got created).
    if (name === 'Mask') {
      const afterMask = await win.evaluate(() => {
        const m = window.__sculptTestMesh;
        const mk = m.userData && m.userData.archdiscStudioSculptMask;
        if (!mk) return { length: 0, nonzero: 0 };
        let nz = 0;
        for (let i = 0; i < mk.length; i++) if (mk[i] > 0) nz++;
        return { length: mk.length, nonzero: nz };
      });
      // Either the mask was created OR existing was painted-into.
      expect(afterMask.length).toBeGreaterThan(0);
      // The mask brush delegates to slice-684's maskPaint when present
      // — but that op isn't installed in this test. The fallback paints
      // locally and SHOULD show nonzero values.
      expect(afterMask.nonzero).toBeGreaterThan(0);
    } else {
      // Vertex-displacement brush: at least one vertex must have moved.
      const after = await win.evaluate(() => {
        const m = window.__sculptTestMesh;
        return Array.from(m.geometry.attributes.position.array);
      });
      let moved = 0;
      let maxDelta = 0;
      for (let i = 0; i < before.length; i++) {
        const d = Math.abs(after[i] - before[i]);
        if (d > 1e-7) moved++;
        if (d > maxDelta) maxDelta = d;
      }
      expect(moved).toBeGreaterThan(0);
      // eslint-disable-next-line no-console
      console.log(`  ${String(runIdx).padStart(2, '0')}. ${name.padEnd(11)} → moved ${moved} verts (max Δ=${maxDelta.toFixed(4)}) · touched=${result.touched}`);
    }

    await win.screenshot({
      path: path.join(OUT, `${String(runIdx).padStart(2, '0')}-${name.toLowerCase()}.png`),
    });
    runIdx++;
  }

  // ── Utility ops smoke ─────────────────────────────────────────────────

  // SetActive → GetActive round trip.
  const sa = await win.evaluate(() => window.__studioSculptBrushSetActive('Crease'));
  expect(sa.ok).toBe(true);
  expect(sa.active).toBe('Crease');
  const ga = await win.evaluate(() => window.__studioSculptBrushGetActive());
  expect(ga.ok).toBe(true);
  expect(ga.active).toBe('Crease');

  // Invalid name path.
  const bad = await win.evaluate(() => window.__studioSculptBrushSetActive('NotARealBrush'));
  expect(bad.ok).toBe(false);
  expect(bad.valid).toEqual(expect.arrayContaining(ALL_BRUSHES));

  // ApplyActive: brush is Crease now; reset the cube and call.
  await win.evaluate(() => {
    const THREE = window.THREE;
    const m = window.__sculptTestMesh;
    if (m && m.geometry && m.geometry.dispose) m.geometry.dispose();
    m.geometry = new THREE.BoxGeometry(2, 2, 2, 32, 32, 32);
    m.geometry.computeVertexNormals();
  });
  const beforeApply = await win.evaluate(() => Array.from(window.__sculptTestMesh.geometry.attributes.position.array));
  const applyR = await win.evaluate(() => window.__studioSculptBrushApplyActive([1, 0, 0], 0.6, 0.7));
  expect(applyR.ok).toBe(true);
  expect(applyR.active).toBe('Crease');
  const afterApply = await win.evaluate(() => Array.from(window.__sculptTestMesh.geometry.attributes.position.array));
  let movedApply = 0;
  for (let i = 0; i < beforeApply.length; i++) {
    if (Math.abs(afterApply[i] - beforeApply[i]) > 1e-7) movedApply++;
  }
  expect(movedApply).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '26-apply-active.png') });
  // eslint-disable-next-line no-console
  console.log('  ApplyActive(Crease): moved', movedApply, 'verts');

  // Command palette registration.
  const cmds = await win.evaluate(() => window.__studioCommandList && window.__studioCommandList('sculpt'));
  expect(cmds && cmds.ok).toBe(true);
  // Every brush + 5 utils → at least 30 entries under 'sculpt'.
  expect(cmds.count).toBeGreaterThanOrEqual(ALL_BRUSHES.length + 5);
  const names = (cmds.commands || []).map((c) => c.name);
  for (const n of ALL_BRUSHES) {
    expect(names).toContain('__studioSculptBrush' + n);
  }

  // Idempotency.
  const reinstall = await win.evaluate(async (code) => {
    // eslint-disable-next-line no-eval
    return eval(code);
  }, bundle);
  expect(reinstall.ok).toBe(true);
  expect(reinstall.alreadyInstalled).toBe(true);

  // ── Wrap up. ───────────────────────────────────────────────────────
  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(150);
  await app.close();
});
