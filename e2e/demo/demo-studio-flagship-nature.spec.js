// Studio FLAGSHIP — "a cinematic flythrough of a forested river valley at golden
// hour" (PATH-TRACED PHOTOREAL VIDEO deliverable).
//
// ─────────────────────────────────────────────────────────────────────────────
// ONE SINGLE CONTINUOUS VIDEO of the FULL Studio pipeline, captured end-to-end:
//   empty viewport → BUILD the landscape (visibly: the eroded-noise terrain with
//   a carved river valley, hundreds of L-system trees in groves, rock/grass/fern
//   scatter, and a water plane appear in the live raster viewport) → SHADE (real
//   4K PBR: bark / foliage / rock / grass / transmissive water / dirt) → ANIMATE
//   (per frame: wind SWAY ripples the canopies + grass, summed-sine ripples move
//   the WATER surface so its reflections shimmer) → RENDER via
//   window.__studioRunPathTracedSequence (HDRI SKY as a VISIBLE rendered
//   background + 4K PBR + ACES/filmic grade + physical thin-lens DOF + a
//   cinematic descending flythrough camera that sweeps DOWN the river valley) →
//   frames DRAIN to disk one-at-a-time (bounded memory even at 4k) → ffmpeg
//   stitches them into ONE continuous mp4:
//     e2e/demo/shots/studio/flagship/nature-valley-photoreal.mp4
//
// This is the SAME path-traced-sequence pattern as demo-studio-flagship-city.spec
// .js (the human-in-city flagship) — only the SUBJECT changes (the procedural
// nature environment instead of the rigged humanoid) and the per-frame poseFrame
// drives the wind/water ANIMATE hook + returns a cinematic flythrough camera spec
// instead of advancing a locomotion rig. The nature environment is SELF-GROUNDED
// (its own terrain + water), so groundless:true (no interior room shell) — the
// landscape, not a floor, fills the frame. spp / frameCount / resolution / fps /
// env / fStop are PARAMETERS (env-var overridable) so a cheap PREVIEW (24f @ 32spp
// @ 1080p) and a FINAL (4k / more spp+frames) share ONE code path. A light
// viewport-raster pass is kept ONLY as an optional fast proof
// (FLAGSHIP_RASTER_PROOF=1) — it is NOT the deliverable.
//
// ⚠️ DO NOT run this while a LoRA train / mlx serve / other heavy GPU work is in
// flight — the path tracer is GPU-heavy (and the forest BVH is large: ~222k tris).
// Launch it via e2e/demo/render-flagship-photoreal.sh (point FLAGSHIP_SPEC at this
// file) when the GPU is free. This is direct procedural animation (no LLM).
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
const ENV_PRESET = process.env.FLAGSHIP_ENV || 'golden';                  // golden-hour sky
const FSTOP      = parseFloat(process.env.FLAGSHIP_FSTOP || '4.0');       // DOF (wider for landscape depth)
const RASTER_PROOF = process.env.FLAGSHIP_RASTER_PROOF === '1';           // optional fast raster proof

// Landscape parameters (env-overridable). A frame-dominating valley: large terrain,
// dense forest, a carved river, summer canopy. Seed is reproducible.
const TERRAIN  = parseInt(process.env.FLAGSHIP_NATURE_TERRAIN || '220', 10);
const TREES    = parseInt(process.env.FLAGSHIP_NATURE_TREES || '320', 10);
const RELIEF   = parseFloat(process.env.FLAGSHIP_NATURE_RELIEF || '14');
const SEASON   = process.env.FLAGSHIP_NATURE_SEASON || 'summer';
const WATERLVL = parseFloat(process.env.FLAGSHIP_NATURE_WATER || '-1.5');
const SEED     = parseInt(process.env.FLAGSHIP_NATURE_SEED || '229', 10);

test('Studio flagship — path-traced photoreal flythrough of a forested river valley (video)', async () => {
  test.setTimeout(120 * 60 * 1000);   // forest BVH + path tracing is slow; generous ceiling
  fs.mkdirSync(ROOT, { recursive: true });
  const seqDir = path.join(ROOT, 'pt-seq-nature'); fs.mkdirSync(seqDir, { recursive: true });

  // Built dist (no --dev): electron loads frontend/dist/index.html.
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js')], slowMo: 10 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { try { window.localStorage.setItem('studio.v3.tour-seen', '1'); window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} }).catch(() => {});
  await win.reload().catch(() => {});
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioBuildNature === 'function'
    && typeof window.__studioNatureAnimate === 'function'
    && typeof window.__studioRunPathTracedSequence === 'function'
    && !!window.__archdiscViewport, { timeout: 30000 });

  const canvas = win.locator('[data-testid="studio-viewport-canvas"]');
  await expect(canvas).toBeVisible({ timeout: 15000 });

  // ── BUILD (visibly): the procedural NATURE ENVIRONMENT — an eroded multi-octave
  //    terrain heightfield with a carved meandering river valley, hundreds of
  //    L-system trees (conifer/broadleaf/birch/shrub) merged per-species into a
  //    grove layout, rock/grass/fern scatter, and a rippling water plane, with
  //    depth-haze fog. We also measure the terrain bounds so the flythrough camera
  //    stays framed on the valley. The PT supplies its own HDRI sky + key.
  const build = await win.evaluate(({ TERRAIN, TREES, RELIEF, SEASON, WATERLVL, SEED }) => {
    const TH = window.__archdiscTHREE;
    const nat = window.__studioBuildNature({
      terrainSize: TERRAIN, treeCount: TREES, relief: RELIEF,
      species: ['conifer', 'broadleaf', 'birch', 'shrub'],
      waterLevel: WATERLVL, season: SEASON, seed: SEED, fog: true,
    });
    // measure the nature bounds (so the camera flythrough stays framed on it).
    const scene = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    const box = new TH.Box3();
    if (scene) scene.traverse((o) => { if (o.isMesh && o.userData && o.userData.archdiscStudioNature) { o.updateMatrixWorld(true); box.expandByObject(o); } });
    const min = box.isEmpty() ? { x: -110, y: 0, z: -110 } : box.min;
    const max = box.isEmpty() ? { x: 110, y: 20, z: 110 } : box.max;
    window.__natureBounds = { min: { x: min.x, y: min.y, z: min.z }, max: { x: max.x, y: max.y, z: max.z } };
    // 4K PBR upgrade (bark/foliage/rock/grass/water scans stream on).
    let mats = null; try { mats = window.__studioLookdevMaterials(); } catch (_) {}
    return { nature: nat, bounds: window.__natureBounds, materialsApplied: mats && mats.applied };
  }, { TERRAIN, TREES, RELIEF, SEASON, WATERLVL, SEED });
  console.log(`[flagship-nature] nature: ${build.nature.bodies} bodies, ${build.nature.tris} tris, ${build.nature.treeCount} trees, season=${build.nature.season}, fog=${build.nature.fog} — materials ${build.materialsApplied}`);
  console.log(`[flagship-nature] bounds: ${JSON.stringify(build.bounds)}`);
  expect(build.nature && build.nature.ok, 'nature built').toBeTruthy();
  expect(build.nature.treeCount, 'forest has trees').toBeGreaterThan(0);
  expect(build.nature.tris, 'nature has geometry').toBeGreaterThan(0);
  await win.waitForTimeout(500);   // let the live raster viewport show the built valley

  // ── OPTIONAL fast viewport-raster proof (NOT the deliverable) — a few frames
  //    screenshotted from the live viewport (animating wind/water + sweeping the
  //    camera) so reviewers can sanity-check composition before the slow PT render.
  if (RASTER_PROOF) {
    const rasterDir = path.join(ROOT, 'raster-proof-nature'); fs.mkdirSync(rasterDir, { recursive: true });
    for (let i = 0; i < 6; i++) {
      await win.evaluate(({ i }) => {
        const vp = window.__archdiscViewport, cam = vp && vp.camera;
        window.__studioNatureAnimate(i * 0.5);   // advance wind + water
        const b = window.__natureBounds || { min: { x: -110, y: 0, z: -110 }, max: { x: 110, y: 20, z: 110 } };
        const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
        const span = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
        const u = i / 5;
        // descend + push down the valley (−Z → +Z along the river axis).
        if (cam) {
          const z = b.min.z + span * (0.1 + u * 0.7);
          cam.position.set(cx + span * 0.18, b.max.y + span * (0.32 - u * 0.18), z - span * 0.32);
          cam.lookAt(cx, b.min.y + (b.max.y - b.min.y) * 0.3, z + span * 0.18);
          cam.fov = 50; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
        }
      }, { i });
      await win.waitForTimeout(60);
      await canvas.screenshot({ path: path.join(rasterDir, `proof-${String(i).padStart(2, '0')}.png`) });
    }
    console.log(`[flagship-nature] raster proof: 6 frames → ${rasterDir}`);
  }

  // ── THE DELIVERABLE: PATH-TRACED FLYTHROUGH SEQUENCE ──────────────────────────
  // The whole sequence runs inside ONE win.evaluate (page context) so the
  // poseFrame closure — which advances the wind/water ANIMATE hook and returns the
  // cinematic flythrough camera spec for each frame — lives where the live scene
  // lives. Each frame: the wind sways the canopies + grass and the water plane
  // re-displaces (so harvestScene re-bakes a different, living landscape), the
  // camera descends + sweeps DOWN the river valley, and the path tracer renders
  // the HDRI sky as a VISIBLE background with DOF (the near grove sharp, the far
  // ridgeline + haze in soft bokeh). Frames read back to PNG dataURLs, drained to
  // disk one-at-a-time to bound memory.
  console.log(`[flagship-nature] path-traced sequence: ${FRAMES} frames @ ${SPP} spp @ ${RES}, env=${ENV_PRESET}, fStop=${FSTOP}, season=${SEASON}`);
  const t0 = Date.now();
  let frameIdx = 0;
  // Drain frames to disk via a binding the page calls per finished frame.
  await win.exposeFunction('__flagshipNatureWriteFrame', (dataUrl) => {
    const name = `frame-${String(frameIdx).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(seqDir, name), Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    frameIdx++;
    return frameIdx;
  });

  const seq = await win.evaluate(async ({ SPP, FRAMES, RES, ENV_PRESET, FSTOP }) => {
    const b = window.__natureBounds || { min: { x: -110, y: 0, z: -110 }, max: { x: 110, y: 20, z: 110 } };
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    const span = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    const valleyY = b.min.y + (b.max.y - b.min.y) * 0.3;

    // poseFrame: advance the wind + water for frame i, then return a cinematic
    // descending flythrough camera spec. The camera starts high + back over the
    // valley head and pushes DOWN the river axis (+Z) while gently descending, a
    // slow lateral drift adding parallax. Focus on the mid-valley so the near
    // grove is sharp and the far ridgeline/haze fall into soft bokeh.
    const poseFrame = async (i, n) => {
      const u = n > 1 ? i / (n - 1) : 0;
      // advance the living landscape (canopy sway + water ripple) — t in seconds.
      window.__studioNatureAnimate(u * (n / 24) * 2.0);
      const z = b.min.z + span * (0.08 + u * 0.74);          // travel down the valley
      const eyeY = b.max.y + span * (0.34 - u * 0.20);       // descend over the arc
      const side = Math.sin(u * Math.PI) * span * 0.14;      // lateral parallax drift
      const targetZ = z + span * 0.22;
      const target = [cx + side * 0.5, valleyY, targetZ];
      const eye = [cx + side, eyeY, z - span * 0.30];
      const dx = eye[0] - target[0], dy = eye[1] - target[1], dz = eye[2] - target[2];
      return {
        position: eye,
        lookAt: target,
        fov: 50,
        // focus on the look target (mid-valley) so near grove sharp, far haze bokeh.
        focusDistance: Math.hypot(dx, dy, dz),
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
      groundless: true,        // nature is self-grounded (its own terrain + water)
      showBackground: true,    // render the HDRI sky as a VISIBLE background
      fStop: FSTOP,
      // DRAIN each frame to disk the instant it finishes → bounded memory even at 4k.
      onFrameData: async (du) => { written = await window.__flagshipNatureWriteFrame(du); },
    });
    return { width: out.width, height: out.height, spp: out.spp, frameCount: out.frameCount, written };
  }, { SPP, FRAMES, RES, ENV_PRESET, FSTOP });
  const renderSecs = Math.round((Date.now() - t0) / 1000);
  console.log(`[flagship-nature] path-traced ${seq.frameCount} frames @ ${seq.spp} spp @ ${seq.width}x${seq.height} in ${renderSecs}s (${(renderSecs / Math.max(1, seq.frameCount)).toFixed(1)}s/frame)`);

  // ── STITCH the path-traced frames into ONE continuous mp4 (the DELIVERABLE).
  const DELIVERABLE = path.join(ROOT, 'nature-valley-photoreal.mp4');
  let encoded = false;
  try {
    execFileSync('ffmpeg', ['-y', '-framerate', String(FPS), '-i', path.join(seqDir, 'frame-%04d.png'),
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', DELIVERABLE], { stdio: 'ignore' });
    encoded = fs.existsSync(DELIVERABLE) && fs.statSync(DELIVERABLE).size > 0;
  } catch (e) { console.log(`[flagship-nature] ffmpeg encode failed: ${String(e.message || e)}`); }
  const kb = encoded ? Math.round(fs.statSync(DELIVERABLE).size / 1024) : 0;

  // Keep a hero STILL (a mid-flythrough frame) for quick thumbnail review.
  const written = fs.readdirSync(seqDir).filter((f) => /^frame-\d+\.png$/.test(f)).sort();
  if (written.length) {
    const heroSrc = path.join(seqDir, written[Math.floor(written.length / 2)]);
    fs.copyFileSync(heroSrc, path.join(ROOT, 'nature-valley-photoreal-hero.png'));
  }

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; }).catch(() => {});
  await app.close();

  console.log('\n=== STUDIO FLAGSHIP NATURE — PATH-TRACED PHOTOREAL VIDEO ===');
  console.log(`deliverable mp4: ${encoded ? DELIVERABLE : 'FAILED'}${encoded ? ` (${kb}KB, ${seq.frameCount}f @ ${FPS}fps)` : ''}`);
  console.log(`render: ${seq.frameCount} frames @ ${seq.spp} spp @ ${seq.width}x${seq.height} (sky=${ENV_PRESET}, DOF f/${FSTOP}) in ${renderSecs}s`);
  console.log(`hero still: ${written.length ? path.join(ROOT, 'nature-valley-photoreal-hero.png') : 'FAILED'}`);

  // ── assertions ────────────────────────────────────────────────────────────
  expect(seq.frameCount, 'frames rendered').toBe(FRAMES);
  expect(seq.written, 'frames written to disk').toBe(FRAMES);
  expect(written.length, 'PNG frames on disk').toBe(FRAMES);
  // every path-traced frame must be a real image (sky + landscape), not a blank.
  const minBytes = Math.min(...written.map((f) => fs.statSync(path.join(seqDir, f)).size));
  expect(minBytes, 'path-traced frames are non-blank').toBeGreaterThan(20000);
  expect(encoded, 'nature-valley-photoreal.mp4 encoded').toBeTruthy();
  expect(kb, 'deliverable mp4 non-trivial').toBeGreaterThan(0);
});
