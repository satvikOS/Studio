// ArchDisc Studio V3 — glTF KHR-extension export polish (slice 768).
//
// Headed Mac-Electron spec. Boots Studio V3, spawns a cube tagged for
// every KHR-userData marker the polish layer understands, plus a real
// THREE.PointLight added directly to the scene, runs the export op with
// `includeKHR: true`, and asserts the resulting JSON contains all four
// KHR extension strings + a validator-clean result. Five named camera
// angles per the multi-cam memory.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-gltfx');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — glTF export polish: KHR extensions injected + valid', async () => {
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

  // Make sure gltfx ops are installed.
  await win.evaluate(async () => {
    if (typeof window.__studioGLTFXExport !== 'function') {
      await import('/src/workbenches/studio/v3/gltfx/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioGLTFXExport === 'function',
    null, { timeout: 20000 });
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) ListExtensions sanity. ────────────────────────────────────────
  const listRes = await win.evaluate(() => window.__studioGLTFXListExtensions());
  console.log('[gltfx] supported:', JSON.stringify(listRes));
  expect(listRes.ok).toBe(true);
  expect(listRes.supported).toEqual(expect.arrayContaining([
    'KHR_lights_punctual',
    'KHR_materials_unlit',
    'KHR_materials_clearcoat',
    'KHR_materials_emissive_strength',
  ]));

  // ── 2) Build a scene: spawn a Studio cube with userData markers for
  //      each material extension, plus a THREE.PointLight. ──────────────
  const spawned = await win.evaluate(() => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    // Spawn a normal Studio cube via the registered op.
    const m = window.__studioSpawnCube
      ? window.__studioSpawnCube()
      : (() => {
          // Fallback: spawn via the v3 spawn module directly.
          const cube = new THREE.Mesh(
            new THREE.BoxGeometry(0.03, 0.03, 0.03),
            new THREE.MeshStandardMaterial({ color: 0x9aa6b2 }),
          );
          cube.userData.archdiscStudioPrimitive = true;
          cube.userData.archdiscStudioPrimitiveKind = 'cube';
          cube.name = 'cube-gltfx';
          scene.add(cube);
          return cube;
        })();
    // Stamp the userData markers so the polish layer injects all 3
    // material extensions for the cube's material.
    if (m && m.material) {
      m.material.name = 'gltfx-test-mat';
      m.material.userData = m.material.userData || {};
      m.material.userData.clearcoat = 0.7;
      m.material.userData.clearcoatRoughness = 0.2;
      m.material.userData.emissiveStrength = 4.2;
      m.material.userData.unlit = false; // not unlit for the cube
    }
    // Spawn an unlit-tagged second cube so KHR_materials_unlit lands too.
    const unlitMat = new THREE.MeshStandardMaterial({ color: 0xffcc66 });
    unlitMat.name = 'gltfx-unlit-mat';
    unlitMat.userData = { unlit: true };
    const unlitCube = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.025), unlitMat);
    unlitCube.position.set(0.05, 0, 0);
    unlitCube.userData.archdiscStudioPrimitive = true;
    unlitCube.userData.archdiscStudioPrimitiveKind = 'cube';
    unlitCube.name = 'cube-gltfx-unlit';
    scene.add(unlitCube);

    // Add a real PointLight to the scene.
    const light = new THREE.PointLight(0xffd29a, 8.0, 2.5, 2);
    light.position.set(0.08, 0.1, 0.06);
    light.name = 'GLTFX-PointLight';
    scene.add(light);

    return {
      cubeUuid: m && m.uuid,
      unlitCubeUuid: unlitCube.uuid,
      lightUuid: light.uuid,
      lightName: light.name,
    };
  });
  console.log('[gltfx] spawned:', JSON.stringify(spawned));
  expect(typeof spawned.cubeUuid).toBe('string');
  expect(typeof spawned.lightUuid).toBe('string');
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '01-scene.png') });

  // ── 3) Export with KHR enabled. ──────────────────────────────────────
  const exp = await win.evaluate(async () => {
    const r = await window.__studioGLTFXExport({ includeKHR: true });
    return {
      ok: r.ok,
      summary: r.summary,
      jsonString: r.json ? JSON.stringify(r.json) : null,
      extensionsUsed: r.json && r.json.extensionsUsed,
      hasTopLights: !!(r.json && r.json.extensions && r.json.extensions.KHR_lights_punctual),
      topLightsCount: r.json && r.json.extensions && r.json.extensions.KHR_lights_punctual
        ? r.json.extensions.KHR_lights_punctual.lights.length : 0,
      materialNames: r.json && r.json.materials
        ? r.json.materials.map((m) => m.name) : [],
      materialExtensions: r.json && r.json.materials
        ? r.json.materials.map((m) => m.extensions ? Object.keys(m.extensions) : []) : [],
    };
  });
  console.log('[gltfx] export summary:', JSON.stringify(exp.summary));
  console.log('[gltfx] extensionsUsed:', JSON.stringify(exp.extensionsUsed));
  console.log('[gltfx] materials:', JSON.stringify(exp.materialNames), JSON.stringify(exp.materialExtensions));
  expect(exp.ok).toBe(true);
  expect(typeof exp.jsonString).toBe('string');

  // The exported JSON string should contain each KHR extension name.
  expect(exp.jsonString).toContain('KHR_lights_punctual');
  expect(exp.jsonString).toContain('KHR_materials_unlit');
  expect(exp.jsonString).toContain('KHR_materials_clearcoat');
  expect(exp.jsonString).toContain('KHR_materials_emissive_strength');

  // The top-level KHR_lights_punctual.lights[] should be non-empty.
  expect(exp.hasTopLights).toBe(true);
  expect(exp.topLightsCount).toBeGreaterThanOrEqual(1);

  // The export summary should reflect what was injected (lights >= 1,
  // clearcoat >= 1, emissive >= 1, unlit >= 1).
  expect(exp.summary).toBeTruthy();
  expect(exp.summary.lights).toBeGreaterThanOrEqual(1);
  expect(exp.summary.clearcoat).toBeGreaterThanOrEqual(1);
  expect(exp.summary.emissive).toBeGreaterThanOrEqual(1);
  expect(exp.summary.unlit).toBeGreaterThanOrEqual(1);

  // extensionsUsed should list every extension we injected.
  expect(exp.extensionsUsed).toEqual(expect.arrayContaining([
    'KHR_lights_punctual',
    'KHR_materials_unlit',
    'KHR_materials_clearcoat',
    'KHR_materials_emissive_strength',
  ]));

  await win.screenshot({ path: path.join(OUT, '02-exported.png') });

  // ── 4) Validate passes. ──────────────────────────────────────────────
  const val = await win.evaluate(async (jsonStr) => {
    const json = JSON.parse(jsonStr);
    return window.__studioGLTFXValidate({ json });
  }, exp.jsonString);
  console.log('[gltfx] validate:', JSON.stringify(val));
  expect(val.ok).toBe(true);
  expect(val.valid).toBe(true);
  expect(val.errors.length).toBe(0);

  // ── 5) Validator also catches a deliberately-broken JSON. ────────────
  const badVal = await win.evaluate(() => {
    const bad = {
      asset: { version: '1.0' }, // wrong version
      extensionsUsed: ['KHR_materials_clearcoat'],
      materials: [{
        name: 'bad',
        extensions: {
          KHR_materials_clearcoat: { clearcoatFactor: 2.5 }, // out of [0,1]
        },
      }],
      nodes: [{
        extensions: {
          KHR_lights_punctual: { light: 42 }, // dangling
        },
      }],
    };
    return window.__studioGLTFXValidate({ json: bad });
  });
  console.log('[gltfx] badVal:', JSON.stringify(badVal));
  expect(badVal.ok).toBe(true);
  expect(badVal.valid).toBe(false);
  expect(badVal.errors.length).toBeGreaterThanOrEqual(3);

  // ── 6) Command palette discovery. ────────────────────────────────────
  const search = await win.evaluate(() => {
    const r = window.__studioCommandSearch
      ? window.__studioCommandSearch('GLTFX', 80)
      : { ok: false, hits: [] };
    return { ok: r.ok, names: (r.hits || []).map((h) => h.name) };
  });
  console.log('[gltfx] search "GLTFX" hits:', JSON.stringify(search.names));
  if (search.ok) {
    for (const expected of [
      '__studioGLTFXExport',
      '__studioGLTFXListExtensions',
      '__studioGLTFXValidate',
    ]) {
      expect(search.names).toContain(expected);
    }
  }

  // ── 7) Five-camera sweep. ────────────────────────────────────────────
  const cams = [
    { name: 'front', pos: [0, 0.06, 0.18], target: [0.03, 0.02, 0] },
    { name: 'iso',   pos: [0.13, 0.13, 0.13], target: [0.03, 0.02, 0] },
    { name: 'right', pos: [0.18, 0.06, 0], target: [0.03, 0.02, 0] },
    { name: 'top',   pos: [0.03, 0.2, 0.001], target: [0.03, 0.02, 0] },
    { name: 'close', pos: [0.08, 0.06, 0.08], target: [0.03, 0.02, 0] },
  ];
  for (const c of cams) {
    let snapped = false;
    try {
      await win.evaluate(({ pos, target }) => {
        const v = window.__archdiscViewport;
        if (!v || !v.camera) return false;
        v.camera.position.set(pos[0], pos[1], pos[2]);
        v.camera.lookAt(target[0], target[1], target[2]);
        if (v.orbitControls) {
          v.orbitControls.target.set(target[0], target[1], target[2]);
          v.orbitControls.update();
        }
        v.camera.updateMatrixWorld(true);
        if (v.renderer && v.scene) v.renderer.render(v.scene, v.camera);
        return true;
      }, c);
      snapped = true;
    } catch (_) {
      try {
        await win.evaluate((v) => {
          if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
          else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
        }, c.name);
        snapped = true;
      } catch (_) {}
    }
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${c.name}.png`) });
    expect(snapped).toBe(true);
  }

  // eslint-disable-next-line no-console
  console.log('  slice 768: KHR extensions injected — lights', exp.summary.lights,
    '| unlit', exp.summary.unlit, '| clearcoat', exp.summary.clearcoat,
    '| emissive', exp.summary.emissive);

  await app.close();
});
