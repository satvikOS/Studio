// ArchDisc Studio V3 — Pixar USD layer composition (slice 761).
//
// Headed Mac-Electron spec.  Verifies the pure-JS USD layer-stack
// composer + USDA serializer.
//
// Flow:
//   • boot the V3 shell
//   • ensure the usdlayer autoload has installed __studioUSDLayer*
//   • create base + override layers
//   • add the SAME prim path ('/World/Box') to both layers with
//     CONFLICTING translate attrs — base sets translate=(1,0,0),
//     override sets translate=(2,0,0)
//   • parent BASE as the WEAKER sublayer of OVERRIDE (override is the
//     ROOT and therefore the strongest opinion in Pixar's LIVRPS
//     strength ordering)
//   • __studioUSDLayerCompose('override') → expect the composed
//     /World/Box translate is (2,0,0), i.e. the override won
//   • __studioUSDLayerExportUSDA('override') → expect the USDA string
//     contains the override value '(2, 0, 0)' verbatim
//   • 5 named camera angles get captured for remote-desktop watchers
//
// e2e DOES NOT run during this slice (per the brief); this file just
// has to compile when written.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-usd-layer');
const NAMED_VIEWS = ['front', 'top', 'right', 'iso', 'close'];

test('Studio V3 — Pixar USD layer composition (slice 761)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });
  // --dev may auto-open a DevTools window; pick the real app window.
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

  // ── Make sure the USD layer module is installed. ─────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioUSDLayerCreate !== 'function') {
      await import('/src/workbenches/studio/v3/usdlayer/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioUSDLayerCreate === 'function'
       && typeof window.__studioUSDLayerAddPrim === 'function'
       && typeof window.__studioUSDLayerAddSublayer === 'function'
       && typeof window.__studioUSDLayerCompose === 'function'
       && typeof window.__studioUSDLayerExportUSDA === 'function'
       && typeof window.__studioUSDLayerList === 'function',
    null, { timeout: 20000 }
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── Reset the in-memory registry so a leftover layer from a prior
  //    test re-run doesn't pollute the stack. ───────────────────────
  await win.evaluate(() => window.__studioUSDLayerReset && window.__studioUSDLayerReset());

  // ── 1) Create the base layer + override layer. ────────────────────
  const createBase = await win.evaluate(() => window.__studioUSDLayerCreate('base'));
  expect(createBase.ok).toBe(true);
  expect(createBase.name).toBe('base');

  const createOverride = await win.evaluate(() => window.__studioUSDLayerCreate('override'));
  expect(createOverride.ok).toBe(true);
  expect(createOverride.name).toBe('override');

  const list = await win.evaluate(() => window.__studioUSDLayerList());
  expect(list.ok).toBe(true);
  expect(list.names).toEqual(expect.arrayContaining(['base', 'override']));

  // ── 2) Add /World/Box to BOTH layers with conflicting translate. ──
  // Base sets translate=(1,0,0), override sets translate=(2,0,0).
  // override is the ROOT layer of the composition; in Pixar's LIVRPS
  // strength ordering the root layer's local opinions are the
  // strongest, so override's value must win at compose time.
  const baseAdd = await win.evaluate(() => window.__studioUSDLayerAddPrim(
    'base',
    '/World/Box',
    'Xform',
    {
      'xformOp:translate': [1, 0, 0],
      'xformOpOrder': ['xformOp:translate'],
    },
  ));
  expect(baseAdd.ok).toBe(true);

  const overrideAdd = await win.evaluate(() => window.__studioUSDLayerAddPrim(
    'override',
    '/World/Box',
    'Xform',
    {
      'xformOp:translate': [2, 0, 0],
      'xformOpOrder': ['xformOp:translate'],
    },
  ));
  expect(overrideAdd.ok).toBe(true);

  // ── 3) Parent base as the WEAKER sublayer of override. ───────────
  const sub = await win.evaluate(() => window.__studioUSDLayerAddSublayer('override', 'base'));
  expect(sub.ok).toBe(true);

  // ── 4) Compose the stack rooted at override. ─────────────────────
  const composed = await win.evaluate(() => window.__studioUSDLayerCompose('override'));
  expect(composed.ok).toBe(true);
  expect(Array.isArray(composed.prims)).toBe(true);
  expect(composed.prims.length).toBeGreaterThan(0);

  // Find the /World/Box prim and assert the OVERRIDE'S translate won.
  const box = composed.prims.find((p) => p.path === '/World/Box');
  expect(box).toBeTruthy();
  expect(box.typeName).toBe('Xform');
  expect(box.attrs['xformOp:translate']).toEqual([2, 0, 0]);

  // ── 5) Export the composed stack to USDA text. ───────────────────
  const exported = await win.evaluate(() => window.__studioUSDLayerExportUSDA('override'));
  expect(exported.ok).toBe(true);
  expect(typeof exported.usda).toBe('string');
  expect(exported.usda.startsWith('#usda 1.0')).toBe(true);
  // The USDA writer formats a 3-vec as "(x, y, z)" — assert the
  // override value appears verbatim and the masked base value does NOT.
  expect(exported.usda).toContain('(2, 0, 0)');
  expect(exported.usda).not.toContain('(1, 0, 0)');
  // The prim is wrapped under the World Xform root.
  expect(exported.usda).toContain('def Xform "World"');
  expect(exported.usda).toContain('def Xform "Box"');
  expect(exported.usda).toContain('xformOp:translate');

  // ── 6) Spawn a viewport cube so the camera sweep has something to
  //       look at (the USD layer model is in-memory only and doesn't
  //       touch the scene). ─────────────────────────────────────────
  await win.evaluate(() => {
    const THREE = window.THREE;
    const g = new THREE.BoxGeometry(2, 2, 2);
    const m = new THREE.MeshStandardMaterial({ color: 0xb6a87a, roughness: 0.6 });
    const mesh = new THREE.Mesh(g, m);
    // Apply the composed translate so what we see in the viewport
    // matches what the USDA file says.
    mesh.position.set(2, 0, 0);
    mesh.name = 'usd-layer-cube';
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'usdlayer-cube';
    window.__archdiscScene.add(mesh);
    if (typeof window.__studioSelectMesh === 'function') {
      try { window.__studioSelectMesh(mesh); } catch (_) {}
    }
  });
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '01-cube-spawned.png') });

  // ── 7) 5-cam sweep. ──────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 761: composed prims', composed.prims.length,
    'override translate', box.attrs['xformOp:translate'],
    'usda bytes', exported.usda.length);

  await app.close();
});
