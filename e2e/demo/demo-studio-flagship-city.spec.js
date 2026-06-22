// Studio FLAGSHIP — "a person walking, running and jumping through a city street"
// (PATH-TRACED PHOTOREAL VIDEO deliverable).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT CHANGED (run #12/100 → fix): the deliverable used to be a `canvas.
// screenshot()` of the LIVE WebGL viewport every frame (flat raster: no rendered
// sky, no 4K PBR, no GI). The user scored it 12/100 ("not photorealistic, no sky
// rendered, no 4K PBR, no realistic detailing"). The DELIVERABLE is now the GPU
// PATH-TRACED locomotion sequence: each frame advances the rig + travel, BAKES
// the deformed humanoid into world-space geometry, and renders it through
// three-gpu-pathtracer with:
//   • the HDRI SKY as a VISIBLE rendered BACKGROUND (not a flat clear colour),
//   • real 4K PBR scans on skin / fabric / façade / asphalt,
//   • ACES/filmic tone-mapping + a finishing grade (contrast + vignette),
//   • physical thin-lens DOF (the figure sharp, the city + skyline soft bokeh),
//   • a cinematic camera move tracking the figure down the street.
// The frames stitch into one continuous mp4 with ffmpeg:
//   e2e/demo/shots/studio/flagship/human-city-photoreal.mp4
//
// spp / frameCount / resolution are PARAMETERS (env-var overridable) so a cheap
// PREVIEW (24 frames @ 32 spp @ 1080p) and a FINAL (more frames/spp/4k) share one
// path. A light viewport-raster pass is kept ONLY as an optional fast proof
// (FLAGSHIP_RASTER_PROOF=1) — it is NOT the deliverable.
//
// ⚠️ DO NOT run this while a LoRA train / other heavy GPU work is in flight — the
// path tracer is GPU-heavy. Launch it via e2e/demo/render-flagship-photoreal.sh
// when the GPU is free. This is direct rig animation (no LLM in the loop).
// ─────────────────────────────────────────────────────────────────────────────

import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(__dirname, 'shots', 'studio', 'flagship');

// ── RENDER BUDGET (env-overridable) ──────────────────────────────────────────
// Cheap preview defaults; bump via env for the final. See render-flagship-photoreal.sh.
const SPP        = parseInt(process.env.FLAGSHIP_SPP || '32', 10);        // samples/frame
const FRAMES     = parseInt(process.env.FLAGSHIP_FRAMES || '24', 10);     // total frames
const RES        = process.env.FLAGSHIP_RES || '1080p';                   // 720p|1080p|1440p|4k
const FPS        = parseInt(process.env.FLAGSHIP_FPS || '24', 10);
const ENV_PRESET = process.env.FLAGSHIP_ENV || 'daylight';               // sky preset
const FSTOP      = parseFloat(process.env.FLAGSHIP_FSTOP || '3.2');       // DOF (lower = shallower)
const RASTER_PROOF = process.env.FLAGSHIP_RASTER_PROOF === '1';           // optional fast raster proof

// The locomotion arc the figure performs while travelling down the street, mapped
// across the frame range: first third walks, middle third runs, last third jumps.
const CYCLES = ['walk', 'run', 'jump'];
const STRIDE = { walk: 0.9, run: 1.85, jump: 1.4 };   // metres travelled per cycle (+Z)

test('Studio flagship — path-traced photoreal human walking/running/jumping through a city (video)', async () => {
  test.setTimeout(90 * 60 * 1000);   // path-traced sequences are slow; generous ceiling
  fs.mkdirSync(ROOT, { recursive: true });
  const seqDir = path.join(ROOT, 'pt-seq'); fs.mkdirSync(seqDir, { recursive: true });

  // Built dist (no --dev): electron loads frontend/dist/index.html.
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js')], slowMo: 10 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { try { window.localStorage.setItem('studio.v3.tour-seen', '1'); window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} }).catch(() => {});
  await win.reload().catch(() => {});
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioBuildCity === 'function'
    && typeof window.__studioBuildHumanoid === 'function'
    && typeof window.__studioHumanoidAnimate === 'function'
    && typeof window.__studioRunPathTracedSequence === 'function'
    && !!window.__archdiscViewport, { timeout: 30000 });

  const canvas = win.locator('[data-testid="studio-viewport-canvas"]');
  await expect(canvas).toBeVisible({ timeout: 15000 });

  // ── BUILD: the procedural city block (+ distant skyline for depth), then the
  //    rigged humanoid on the carriageway, real PBR skin/cloth materials. The PT
  //    supplies its own HDRI sky + key, so we don't need a viewport light rig.
  const build = await win.evaluate(async () => {
    const TH = window.__archdiscTHREE;
    // 1) CITY — multi-block walkable street (street runs along +Z, the figure's
    //    travel axis) + distant skyline backdrop for skyline depth/haze.
    //    buildCity is async (preloads real CC0 vehicle/tree glbs) — MUST await.
    const city = await window.__studioBuildCity({ blocks: 2, seed: 1971, skyline: true });
    // 2) HUMANOID — drop a rigged biped on the carriageway centre-line (x=0).
    const b = window.__studioBuildHumanoid({ sex: 'male', height: 1.82, pose: 'relaxed-stand' });
    // 3) real 4K skin/cloth PBR upgrade (streams the scans on).
    let mats = null; try { mats = window.__studioLookdevMaterials(); } catch (_) {}
    // 4) measure the figure foot level so we keep the soles on the asphalt.
    let groundY = 0;
    try {
      const store = window.__studioHumanoids || {};
      const h = store[window.__studioHumanoidLast];
      const box = new TH.Box3();
      if (h) for (const sm of (h.skinnedMeshes || [])) { sm.updateMatrixWorld(true); box.expandByObject(sm); }
      groundY = box.isEmpty() ? 0 : box.min.y;
    } catch (_) {}
    window.__cityGroundY = groundY;
    return { city, build: b, materialsApplied: mats && mats.applied, groundY };
  });
  console.log(`[flagship] city: ${JSON.stringify(build.city)}`);
  console.log(`[flagship] humanoid: ${build.build.boneCount} bones, ${build.build.totalVertices} verts, h=${build.build.height} — materials ${build.materialsApplied}, groundY ${build.groundY}`);
  expect(build.city && build.city.ok, 'city built').toBeTruthy();
  expect(build.city.buildings, 'city has buildings').toBeGreaterThan(0);
  expect(build.build.ok, 'humanoid built').toBeTruthy();

  // ── WAIT for the real 4K skin scan + fabric maps to STREAM in (bounded poll)
  //    so the baked-per-frame humanoid is textured, not flat base tint.
  const texReady = await win.waitForFunction(() => {
    const store = window.__studioHumanoids || {};
    const h = store[window.__studioHumanoidLast];
    if (!h) return false;
    const skin = (h.skinnedMeshes || []).find((m) => m.userData && m.userData.archdiscStudioHumanoidShell === 'skin');
    return !!(skin && skin.material && skin.material.map && skin.material.map.image);
  }, { timeout: 60000 }).then(() => true).catch(() => false);
  console.log(`[flagship] skin/cloth textures ready=${texReady}`);
  await win.waitForTimeout(500);

  // ── OPTIONAL fast viewport-raster proof (NOT the deliverable) — a few frames
  //    screenshotted from the live viewport so reviewers can sanity-check the
  //    motion/composition before committing to the slow path-traced render.
  if (RASTER_PROOF) {
    const rasterDir = path.join(ROOT, 'raster-proof'); fs.mkdirSync(rasterDir, { recursive: true });
    for (let i = 0; i < 6; i++) {
      await win.evaluate(({ i }) => {
        const TH = window.__archdiscTHREE, vp = window.__archdiscViewport, cam = vp && vp.camera;
        const cyc = ['walk', 'run', 'jump'][Math.min(2, Math.floor(i / 2))];
        window.__studioHumanoidAnimate({ cycle: cyc, t: (i % 2) / 2 });
        const gY = window.__cityGroundY || 0;
        if (cam) { cam.position.set(2.0, gY + 1.35, i * 1.0 - 4.4); cam.lookAt(0, gY + 1.0, i * 1.0 + 1.5); cam.fov = 40; cam.updateProjectionMatrix(); cam.updateMatrixWorld(); }
      }, { i });
      await win.waitForTimeout(60);
      await canvas.screenshot({ path: path.join(rasterDir, `proof-${String(i).padStart(2, '0')}.png`) });
    }
    console.log(`[flagship] raster proof: 6 frames → ${rasterDir}`);
  }

  // ── THE DELIVERABLE: PATH-TRACED LOCOMOTION SEQUENCE ──────────────────────────
  // The whole sequence runs inside ONE win.evaluate (page context) so the
  // poseFrame closure — which advances the rig/travel and returns the cinematic
  // camera spec for each frame — lives where the live scene + THREE do. The path
  // tracer bakes the deformed humanoid + harvests the city each frame, renders the
  // HDRI sky as a visible background, applies DOF, and reads each frame back to a
  // PNG dataURL. We write the dataURLs to disk frame-by-frame to bound memory.
  console.log(`[flagship] path-traced sequence: ${FRAMES} frames @ ${SPP} spp @ ${RES}, env=${ENV_PRESET}, fStop=${FSTOP}`);
  const t0 = Date.now();
  let frameIdx = 0;
  // Drain frames to disk via a binding the page calls per finished frame.
  await win.exposeFunction('__flagshipWriteFrame', (dataUrl) => {
    const name = `frame-${String(frameIdx).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(seqDir, name), Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    frameIdx++;
    return frameIdx;
  });

  const seq = await win.evaluate(async ({ SPP, FRAMES, RES, ENV_PRESET, FSTOP, CYCLES, STRIDE }) => {
    const TH = window.__archdiscTHREE;
    const store = window.__studioHumanoids || {};
    const h = store[window.__studioHumanoidLast];
    const gY = window.__cityGroundY || 0;

    // Map a global frame index → { cycle, phase t, accumulated travel Z }.
    // Frames split evenly across walk → run → jump; travel accumulates across the
    // whole arc so the figure keeps moving DOWN the street (never resets).
    const perCycle = Math.max(1, Math.floor(FRAMES / CYCLES.length));
    function planFrame(i) {
      const ci = Math.min(CYCLES.length - 1, Math.floor(i / perCycle));
      const cycle = CYCLES[ci];
      const local = i - ci * perCycle;
      const t = (local % perCycle) / perCycle;
      // accumulated travel = full strides of completed cycles + partial of current
      let travel = 0;
      for (let k = 0; k < ci; k++) travel += STRIDE[CYCLES[k]];
      travel += STRIDE[cycle] * t;
      return { cycle, t, travel };
    }

    // poseFrame: advance the rig + travel for frame i, return the cinematic
    // camera spec. A low chase camera trails the figure down the street (figure
    // dominant per scale-to-viewer), focused on the figure so the city bokehs.
    let lastFigureZ = 0;
    const poseFrame = async (i, n) => {
      const { cycle, t, travel } = planFrame(i);
      const a = window.__studioHumanoidAnimate({ cycle, t });
      let figureZ = travel, figureY = gY + 1.0;
      if (h) {
        const arm = h.armature;
        if (!arm.userData.__cityBase) arm.userData.__cityBase = { x: arm.position.x, y: arm.position.y, z: arm.position.z };
        const base = arm.userData.__cityBase;
        const gait = a && a.root ? a.root : { x: 0, y: 0, z: 0 };
        arm.position.set(base.x + (gait.x || 0), base.y + (gait.y || 0), base.z + (gait.z || 0) + travel);
        if (Array.isArray(h.skinnedMeshes)) {
          for (const sm of h.skinnedMeshes) {
            const sb = sm.userData.__cityBase || (sm.userData.__cityBase = { x: sm.position.x, y: sm.position.y, z: sm.position.z });
            sm.position.set(sb.x + (gait.x || 0), sb.y + (gait.y || 0), sb.z + (gait.z || 0) + travel);
          }
        }
        arm.updateMatrixWorld(true);
        if (h.skeleton && h.skeleton.update) h.skeleton.update();
        const box = new TH.Box3();
        for (const sm of (h.skinnedMeshes || [])) { sm.updateMatrixWorld(true); box.expandByObject(sm); }
        if (!box.isEmpty()) { const c = box.getCenter(new TH.Vector3()); figureZ = c.z; figureY = c.y; }
      }
      lastFigureZ = figureZ;
      // Cinematic chase: low, slightly behind + to one side, slow lateral drift
      // across the arc for a moving-camera feel. Lead the look a touch ahead.
      const u = i / Math.max(1, n - 1);                 // 0..1 across the whole shot
      const side = 1.6 + Math.sin(u * Math.PI) * 1.4;   // ease out then in
      const behind = 4.2;
      const eyeY = gY + 1.35 + Math.sin(u * Math.PI) * 0.25;
      return {
        position: [side, eyeY, figureZ - behind],
        lookAt:   [0.0, gY + 1.05, figureZ + 1.4],
        fov: 40,
        // focus on the figure (≈ distance camera→figure) so it stays razor sharp
        // while the receding street + skyline fall into soft bokeh.
        focusDistance: Math.hypot(side, eyeY - (gY + 1.0), behind + 1.4),
        fStop: FSTOP,
      };
    };

    let written = 0;
    const out = await window.__studioRunPathTracedSequence({
      poseFrame,
      frameCount: FRAMES,
      spp: SPP,
      resolutionId: RES,
      envPresetId: ENV_PRESET,
      groundless: true,        // city supplies its own asphalt/streets
      showBackground: true,    // render the HDRI sky as a VISIBLE background
      fStop: FSTOP,
      // DRAIN each frame to disk the instant it finishes → bounded memory even at 4k.
      onFrameData: async (du) => { written = await window.__flagshipWriteFrame(du); },
    });
    return { width: out.width, height: out.height, spp: out.spp, frameCount: out.frameCount, written };
  }, { SPP, FRAMES, RES, ENV_PRESET, FSTOP, CYCLES, STRIDE });
  const renderSecs = Math.round((Date.now() - t0) / 1000);
  console.log(`[flagship] path-traced ${seq.frameCount} frames @ ${seq.spp} spp @ ${seq.width}x${seq.height} in ${renderSecs}s (${(renderSecs / Math.max(1, seq.frameCount)).toFixed(1)}s/frame)`);

  // ── STITCH the path-traced frames into ONE continuous mp4 (the DELIVERABLE).
  const DELIVERABLE = path.join(ROOT, 'human-city-photoreal.mp4');
  let encoded = false;
  try {
    execFileSync('ffmpeg', ['-y', '-framerate', String(FPS), '-i', path.join(seqDir, 'frame-%04d.png'),
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', DELIVERABLE], { stdio: 'ignore' });
    encoded = fs.existsSync(DELIVERABLE) && fs.statSync(DELIVERABLE).size > 0;
  } catch (e) { console.log(`[flagship] ffmpeg encode failed: ${String(e.message || e)}`); }
  const kb = encoded ? Math.round(fs.statSync(DELIVERABLE).size / 1024) : 0;

  // Keep a hero STILL (the sharpest mid-run frame) for quick thumbnail review.
  const written = fs.readdirSync(seqDir).filter((f) => /^frame-\d+\.png$/.test(f)).sort();
  if (written.length) {
    const heroSrc = path.join(seqDir, written[Math.floor(written.length / 2)]);
    fs.copyFileSync(heroSrc, path.join(ROOT, 'human-city-photoreal-hero.png'));
  }

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; }).catch(() => {});
  await app.close();

  console.log('\n=== STUDIO FLAGSHIP CITY — PATH-TRACED PHOTOREAL VIDEO ===');
  console.log(`deliverable mp4: ${encoded ? DELIVERABLE : 'FAILED'}${encoded ? ` (${kb}KB, ${seq.frameCount}f @ ${FPS}fps)` : ''}`);
  console.log(`render: ${seq.frameCount} frames @ ${seq.spp} spp @ ${seq.width}x${seq.height} (sky=${ENV_PRESET}, DOF f/${FSTOP}) in ${renderSecs}s`);
  console.log(`hero still: ${written.length ? path.join(ROOT, 'human-city-photoreal-hero.png') : 'FAILED'}`);

  // ── assertions ────────────────────────────────────────────────────────────
  expect(seq.frameCount, 'frames rendered').toBe(FRAMES);
  expect(seq.written, 'frames written to disk').toBe(FRAMES);
  expect(written.length, 'PNG frames on disk').toBe(FRAMES);
  // every path-traced frame must be a real image (sky + scene), not a blank.
  const minBytes = Math.min(...written.map((f) => fs.statSync(path.join(seqDir, f)).size));
  expect(minBytes, 'path-traced frames are non-blank').toBeGreaterThan(20000);
  expect(encoded, 'human-city-photoreal.mp4 encoded').toBeTruthy();
  expect(kb, 'deliverable mp4 non-trivial').toBeGreaterThan(0);
});
