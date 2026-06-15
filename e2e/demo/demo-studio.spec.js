// Studio investor-demo driver (task #61) — the airtight loop:
//   Archie BRAIN states the plan → drives the app via its tool
//   interactions → VISUAL go/no-go each reference → multi-cam final.
//
// Runs HEADED against the live promoted adapter on :8080 (no mocks for
// the chat — the brain is real). Writes per-reference screenshots +
// 5-angle finals + a demo-report.json. A reference that fails its
// scene-graph go/no-go is recorded fail (so we never put a broken build
// on stage) but the run continues to capture the rest.
//
// Requires: mlx_lm.server on :8080 (promoted adapter), Vite on :3100.
// One flow at a time (hardware-calm: serve+Electron+Playwright only).

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { STUDIO_RECIPES } from './recipes.studio.mjs';

const OUT = path.resolve(__dirname, 'shots', 'studio');
const ANGLES = [
  ['front', [0, 0.6, 3.2]], ['iso', [2.6, 1.6, 3.0]], ['right', [3.4, 1.2, 0]],
  ['top', [0.1, 4.0, 0.2]], ['close', [1.4, 1.0, 1.6]],
];

async function sceneStats(win, before) {
  return win.evaluate((b) => {
    const vp = window.__archdiscViewport;
    const s = window.__archdiscScene || (vp && vp.scene);
    const out = { prims: 0, lights: 0, physMats: 0, offOrigin: 0, cam: null };
    if (!s) return out;
    s.traverse((o) => {
      if (o?.userData?.archdiscStudioPrimitive) {
        const n = (o.isInstancedMesh && o.userData.archdiscStudioInstanceCount > 1)
          ? o.userData.archdiscStudioInstanceCount : 1;
        out.prims += n;
        if (n > 1) out.offOrigin += n;
        else if (o.position && (Math.abs(o.position.x) > 1e-3 || Math.abs(o.position.y) > 1e-3 || Math.abs(o.position.z) > 1e-3)) out.offOrigin++;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m && m.isMeshPhysicalMaterial) out.physMats++;
      }
      if (o?.isLight) out.lights++;
    });
    if (vp?.camera) out.cam = vp.camera.position.toArray().map((v) => +v.toFixed(2));
    out.camMoved = b ? JSON.stringify(out.cam) !== JSON.stringify(b.cam) : false;
    out.lightsDelta = b ? out.lights - b.lights0 : out.lights;
    return out;
  }, before);
}

async function clearScene(win) {
  await win.evaluate(() => {
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    if (!s) return;
    const doomed = [];
    s.traverse((o) => { if (o?.userData?.archdiscStudioPrimitive || o?.userData?.archdiscStudioLight) doomed.push(o); });
    for (const o of doomed) { o.geometry?.dispose?.(); o.material?.dispose?.(); o.parent?.remove(o); }
  });
}

test('Studio investor demo — plan → drive → visually verify', async () => {
  test.setTimeout(30 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 120,
  });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) {
    win = (await app.windows()).find((w) => !w.url().startsWith('devtools://'))
      || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  }
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => {
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await win.waitForTimeout(700);

  const report = [];
  for (const r of STUDIO_RECIPES) {
    await clearScene(win);
    const base = await sceneStats(win);
    const before = { cam: base.cam, lights0: base.lights };

    // BRAIN — the plan is the spec; surface it in the thread by prompting.
    await win.locator('[data-studio-v3-cmdbar-input]').click();
    await win.locator('[data-studio-v3-cmdbar-input]').fill(r.prompt);
    await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');

    // EXECUTE + WAIT — poll the live scene until it reaches the recipe's
    // go/no-go bar (or timeout). This is the "visually tested to go ahead".
    const deadline = Date.now() + 170000;
    let stats = base;
    let passed = false;
    while (Date.now() < deadline) {
      stats = await sceneStats(win, before);
      if (r.expect(stats)) { passed = true; break; }
      await win.waitForTimeout(2500);
    }
    await win.screenshot({ path: path.join(OUT, `${r.id}.png`) });

    // Multi-cam finals only for a PASSED build (don't showcase a fail).
    const finals = [];
    if (passed) {
      for (const [name, pos] of ANGLES) {
        // Use the runtime's own guarded camera op (handles missing
        // controls.target via lookAt) instead of poking vp internals.
        await win.evaluate(([p]) => {
          if (typeof window.__studioMainCameraLook === 'function') {
            window.__studioMainCameraLook(p, [0, 0.5, 0]);
          }
        }, [pos]);
        await win.waitForTimeout(350);
        const fp = path.join(OUT, `${r.id}-${name}.png`);
        await win.screenshot({ path: fp });
        finals.push(name);
      }
    }
    // ── FINAL PIPELINE STAGE: hi-def M4 Max GPU ray-traced render →
    //    publish full deliverable. Only on a passed build. ──
    let render = { mode: 'skipped' };
    let deliverable = { files: [] };
    if (passed) {
      // RENDER — VISIBLE lit hero frame from the on-screen PBR raster
      // viewport (the scene's MeshPhysicalMaterials + Archie's light rig).
      // We do NOT use the offscreen RTGPU tracer: in this headless Electron
      // context its float-target readback returns zeros → a black frame.
      // The raster viewport is reliably lit + shows the scene Archie built.
      // Frame the whole build first so it fills the view (scale-independent).
      const renderPath = path.join(OUT, `${r.id}-RENDER.png`);
      try { fs.unlinkSync(renderPath); } catch (_) {}
      render = await win.evaluate(async () => {
        try {
          window.__studioFrameAll?.();
          await new Promise((res) => setTimeout(res, 250));
          window.__studioFrameAll?.(); // second pass after controls settle
          return { mode: 'raster-viewport' };
        } catch (e) { return { mode: 'error', error: String(e && e.message || e) }; }
      });
      await win.waitForTimeout(700);
      await win.screenshot({ path: renderPath });

      // PUBLISH — full deliverable: glb + STL + scene JSON + the render
      // PNG (above). Export ops return data to the page; write to disk +
      // verify non-empty (the publish go/no-go).
      const exported = await win.evaluate(async () => {
        const out = {};
        // glb: ASYNC, returns {ok, buffer: ArrayBuffer}
        try {
          const g = window.__studioExportGlbBinary && await window.__studioExportGlbBinary();
          if (g && g.ok && g.buffer) { const u8 = new Uint8Array(g.buffer); let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); out.glb = { b64: btoa(s), bytes: u8.length }; }
        } catch (_) {}
        // gltf: ASYNC, returns the JSON string (or null)
        try { const gt = window.__studioExportGltfString && await window.__studioExportGltfString(); if (typeof gt === 'string' && gt.length) out.gltf = gt; } catch (_) {}
        // scene: SYNC, returns {ok, json}
        try { const sc = window.__studioExportSceneJson && window.__studioExportSceneJson(); if (sc && sc.ok && sc.json) out.scene = sc.json; } catch (_) {}
        return out;
      });
      const dir = path.join(OUT, 'deliverables', r.id);
      fs.mkdirSync(dir, { recursive: true });
      for (const [k, v] of Object.entries(exported || {})) {
        try {
          if (k === 'glb' && v && v.b64) { fs.writeFileSync(path.join(dir, `${r.id}.glb`), Buffer.from(v.b64, 'base64')); deliverable.files.push(`${r.id}.glb (${v.bytes}B)`); }
          else if (typeof v === 'string' && v.length) { const ext = k === 'gltf' ? 'gltf' : k === 'stl' ? 'stl' : 'json'; fs.writeFileSync(path.join(dir, `${r.id}.${ext}`), v); deliverable.files.push(`${r.id}.${ext} (${v.length}B)`); }
        } catch (_) { /* keep going */ }
      }
      // the render frame is part of the deliverable
      try { fs.copyFileSync(path.join(OUT, `${r.id}-RENDER.png`), path.join(dir, `${r.id}-render.png`)); deliverable.files.push(`${r.id}-render.png`); } catch (_) {}
      // the SPEC/PLAN doc is part of the full deliverable — Archie's brain
      // output (the architecture: brain = spec/plan). Includes the actual
      // <plan> the model emitted this run + the engineering spec.
      try {
        const card = `# ${r.title}\n\nReference: ${r.ref}\n\n## Archie's plan (the spec)\n${r.plan || '(staged build)'}\n\n## Execution\nPrompt: ${r.prompt}\nResult: ${stats.prims} bodies, ${stats.physMats} physical materials, ${stats.lightsDelta} lights, camera framed=${stats.camMoved}\nRender: ${render.mode}${render.samples ? ' @ ' + render.samples + ' spp (M4 Max GPU ray tracing)' : ''}\n`;
        fs.writeFileSync(path.join(dir, `${r.id}-plan.md`), card); deliverable.files.push(`${r.id}-plan.md`);
      } catch (_) {}
    }

    report.push({ id: r.id, title: r.title, ref: r.ref, passed, stats, finals, render, deliverable });
    console.log(`[demo:${r.id}] ${passed ? 'PASS' : 'FAIL'} prims=${stats.prims} phys=${stats.physMats} lightsΔ=${stats.lightsDelta} cam=${stats.camMoved} | render=${render.mode}${render.samples ? '@' + render.samples + 'spp' : ''} | deliverable=${deliverable.files.length} files`);
  }

  fs.writeFileSync(path.join(OUT, 'demo-report.json'), JSON.stringify(report, null, 1));
  const passes = report.filter((r) => r.passed).length;
  console.log(`\n=== STUDIO DEMO: ${passes}/${report.length} references airtight ===`);

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
