// Studio FLAGSHIP — "a sleek sports car driving through a city street at dusk"
// (PATH-TRACED PHOTOREAL VIDEO deliverable).
//
// ─────────────────────────────────────────────────────────────────────────────
// ONE SINGLE CONTINUOUS VIDEO of the FULL Studio pipeline, captured end-to-end:
//   empty viewport → BUILD the car (visibly, the lofted hull + greenhouse +
//   wheels + emissive light bars appear in the live raster viewport) → SHADE
//   (real 4K PBR: car-paint clearcoat / tinted glass / chrome / rubber) →
//   ANIMATE (the car drives down a city street spline, wheels spinning, fronts
//   steering into the corners) → RENDER via window.__studioRunPathTracedSequence
//   (HDRI SKY as a VISIBLE rendered background + 4K PBR + ACES/filmic grade +
//   physical thin-lens DOF + a cinematic chase camera tracking the car) → frames
//   DRAIN to disk one-at-a-time (bounded memory even at 4k) → ffmpeg stitches
//   them into ONE continuous mp4:
//     e2e/demo/shots/studio/flagship/vehicle-city-photoreal.mp4
//
// This is the SAME path-traced-sequence pattern as demo-studio-flagship-city.spec
// .js (the human-in-city flagship) — only the SUBJECT changes (the car instead of
// the rigged humanoid) and the per-frame poseFrame drives the car along the street
// spline (via the vehicle builder's drive helper) instead of advancing a locomotion
// rig. spp / frameCount / resolution / fps / env / fStop are PARAMETERS (env-var
// overridable) so a cheap PREVIEW (24f @ 32spp @ 1080p) and a FINAL (4k / more
// spp+frames) share ONE code path. A light viewport-raster pass is kept ONLY as an
// optional fast proof (FLAGSHIP_RASTER_PROOF=1) — it is NOT the deliverable.
//
// ⚠️ DO NOT run this while a LoRA train / mlx serve / other heavy GPU work is in
// flight — the path tracer is GPU-heavy. Launch it via
// e2e/demo/render-flagship-photoreal.sh (point FLAGSHIP_SPEC at this file) when the
// GPU is free. This is direct procedural animation (no LLM in the loop).
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
const ENV_PRESET = process.env.FLAGSHIP_ENV || 'golden';                  // dusk sky for the car
const FSTOP      = parseFloat(process.env.FLAGSHIP_FSTOP || '2.4');       // DOF (lower = shallower)
const RASTER_PROOF = process.env.FLAGSHIP_RASTER_PROOF === '1';           // optional fast raster proof

// The car drives the FULL length of the city carriageway across the frame range:
// u (path fraction) sweeps 0 → 1, so the body moves continuously down the street,
// cornering on the S-bend, wheels spinning by distance, fronts steering into turns.
const BODY_STYLE = process.env.FLAGSHIP_VEHICLE_STYLE || 'coupe';
const CAM_MODE   = process.env.FLAGSHIP_VEHICLE_CAM   || 'chase';         // chase|side|low

test('Studio flagship — path-traced photoreal sports car driving through a city (video)', async () => {
  test.setTimeout(90 * 60 * 1000);   // path-traced sequences are slow; generous ceiling
  fs.mkdirSync(ROOT, { recursive: true });
  const seqDir = path.join(ROOT, 'pt-seq-vehicle'); fs.mkdirSync(seqDir, { recursive: true });

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
    && typeof window.__studioBuildVehicle === 'function'
    && typeof window.__studioVehicleDriveFrame === 'function'
    && typeof window.__studioRunPathTracedSequence === 'function'
    && !!window.__archdiscViewport, { timeout: 30000 });

  const canvas = win.locator('[data-testid="studio-viewport-canvas"]');
  await expect(canvas).toBeVisible({ timeout: 15000 });

  // ── BUILD (visibly): the procedural city block (+ distant skyline for depth),
  //    then the fully PARAMETRIC sports car (lofted smooth hull from profile
  //    curves, tinted-glass greenhouse, spoked wheels + rubber tyres, emissive
  //    head/taillight bars, chrome grille/trim). The PT supplies its own HDRI sky
  //    + key, so we don't need a viewport light rig.
  const build = await win.evaluate(({ BODY_STYLE }) => {
    // 1) CITY — multi-block walkable street (street runs along +Z, the car's travel
    //    axis) + distant skyline backdrop for skyline depth/haze.
    const city = window.__studioBuildCity({ blocks: 2, seed: 2026, skyline: true });
    // 2) VEHICLE — build the car ONCE statically (it is re-posed per frame by the
    //    drive helper during the render). Seed + style → a reproducible body.
    const car = window.__studioBuildVehicle({ bodyStyle: BODY_STYLE, seed: 202, ringN: 44 });
    // 3) real 4K car-paint / glass / chrome / rubber PBR upgrade (streams scans on).
    let mats = null; try { mats = window.__studioLookdevMaterials(); } catch (_) {}
    return { city, car, materialsApplied: mats && mats.applied };
  }, { BODY_STYLE });
  console.log(`[flagship-vehicle] city: ${JSON.stringify(build.city)}`);
  console.log(`[flagship-vehicle] car: style=${build.car.style}, ${build.car.meshCount} meshes, ${build.car.triCount} tris, dims=${JSON.stringify(build.car.dims)} — materials ${build.materialsApplied}`);
  expect(build.city && build.city.ok, 'city built').toBeTruthy();
  expect(build.city.buildings, 'city has buildings').toBeGreaterThan(0);
  expect(build.car.ok, 'vehicle built').toBeTruthy();
  expect(build.car.triCount, 'vehicle has geometry').toBeGreaterThan(0);
  await win.waitForTimeout(500);   // let the live raster viewport show the built car

  // ── OPTIONAL fast viewport-raster proof (NOT the deliverable) — a few frames
  //    screenshotted from the live viewport so reviewers can sanity-check the
  //    drive motion / composition before committing to the slow path-traced render.
  if (RASTER_PROOF) {
    const rasterDir = path.join(ROOT, 'raster-proof-vehicle'); fs.mkdirSync(rasterDir, { recursive: true });
    for (let i = 0; i < 6; i++) {
      await win.evaluate(({ i, BODY_STYLE, CAM_MODE }) => {
        const u = i / 5;
        const r = window.__studioVehicleDriveFrame({ u, camera: CAM_MODE, params: { bodyStyle: BODY_STYLE, seed: 202, ringN: 44 } });
        const vp = window.__archdiscViewport, cam = vp && vp.camera;
        if (cam && r && r.cameraSpec) {
          const cs = r.cameraSpec;
          cam.position.set(cs.position[0], cs.position[1], cs.position[2]);
          cam.lookAt(cs.lookAt[0], cs.lookAt[1], cs.lookAt[2]);
          cam.fov = cs.fov || 40; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
        }
      }, { i, BODY_STYLE, CAM_MODE });
      await win.waitForTimeout(60);
      await canvas.screenshot({ path: path.join(rasterDir, `proof-${String(i).padStart(2, '0')}.png`) });
    }
    console.log(`[flagship-vehicle] raster proof: 6 frames → ${rasterDir}`);
  }

  // ── THE DELIVERABLE: PATH-TRACED DRIVE SEQUENCE ───────────────────────────────
  // The whole sequence runs inside ONE win.evaluate (page context) so the
  // poseFrame closure — which advances the car along the street spline and returns
  // the cinematic camera spec for each frame — lives where the live scene + the
  // drive helper do. The drive helper re-poses + re-bakes the car flat each frame;
  // harvestScene re-reads it, so the path-traced video sees the car mid-corner. The
  // path tracer renders the HDRI sky as a VISIBLE background, applies DOF (the car
  // sharp, the receding street + skyline soft bokeh), and reads each frame back to
  // a PNG dataURL. We write the dataURLs to disk frame-by-frame to bound memory.
  console.log(`[flagship-vehicle] path-traced sequence: ${FRAMES} frames @ ${SPP} spp @ ${RES}, env=${ENV_PRESET}, fStop=${FSTOP}, style=${BODY_STYLE}, cam=${CAM_MODE}`);
  const t0 = Date.now();
  let frameIdx = 0;
  // Drain frames to disk via a binding the page calls per finished frame.
  await win.exposeFunction('__flagshipVehicleWriteFrame', (dataUrl) => {
    const name = `frame-${String(frameIdx).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(seqDir, name), Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    frameIdx++;
    return frameIdx;
  });

  const seq = await win.evaluate(async ({ SPP, FRAMES, RES, ENV_PRESET, FSTOP, BODY_STYLE, CAM_MODE }) => {
    const params = { bodyStyle: BODY_STYLE, seed: 202, ringN: 44 };

    // poseFrame: advance the car to fraction u along the street spline for frame i
    // (the drive helper re-poses + re-bakes the live car: position on the curve,
    // heading along the tangent, wheels spun by distance, fronts steered into the
    // turn) and return the chase/side/low cinematic camera spec it computed. We
    // pin the DOF f-stop on the spec so the car stays razor sharp while the street
    // + skyline fall into soft bokeh.
    const poseFrame = async (i, n) => {
      const u = n > 1 ? i / (n - 1) : 0;
      const r = window.__studioVehicleDriveFrame({ u, camera: CAM_MODE, params });
      const cs = (r && r.cameraSpec) ? r.cameraSpec : { position: [6, 3, -6], lookAt: [0, 0.6, 0], fov: 40 };
      return { ...cs, fStop: FSTOP };
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
      onFrameData: async (du) => { written = await window.__flagshipVehicleWriteFrame(du); },
    });
    return { width: out.width, height: out.height, spp: out.spp, frameCount: out.frameCount, written };
  }, { SPP, FRAMES, RES, ENV_PRESET, FSTOP, BODY_STYLE, CAM_MODE });
  const renderSecs = Math.round((Date.now() - t0) / 1000);
  console.log(`[flagship-vehicle] path-traced ${seq.frameCount} frames @ ${seq.spp} spp @ ${seq.width}x${seq.height} in ${renderSecs}s (${(renderSecs / Math.max(1, seq.frameCount)).toFixed(1)}s/frame)`);

  // ── STITCH the path-traced frames into ONE continuous mp4 (the DELIVERABLE).
  const DELIVERABLE = path.join(ROOT, 'vehicle-city-photoreal.mp4');
  let encoded = false;
  try {
    execFileSync('ffmpeg', ['-y', '-framerate', String(FPS), '-i', path.join(seqDir, 'frame-%04d.png'),
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', DELIVERABLE], { stdio: 'ignore' });
    encoded = fs.existsSync(DELIVERABLE) && fs.statSync(DELIVERABLE).size > 0;
  } catch (e) { console.log(`[flagship-vehicle] ffmpeg encode failed: ${String(e.message || e)}`); }
  const kb = encoded ? Math.round(fs.statSync(DELIVERABLE).size / 1024) : 0;

  // Keep a hero STILL (a sharp mid-drive frame) for quick thumbnail review.
  const written = fs.readdirSync(seqDir).filter((f) => /^frame-\d+\.png$/.test(f)).sort();
  if (written.length) {
    const heroSrc = path.join(seqDir, written[Math.floor(written.length / 2)]);
    fs.copyFileSync(heroSrc, path.join(ROOT, 'vehicle-city-photoreal-hero.png'));
  }

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; }).catch(() => {});
  await app.close();

  console.log('\n=== STUDIO FLAGSHIP VEHICLE — PATH-TRACED PHOTOREAL VIDEO ===');
  console.log(`deliverable mp4: ${encoded ? DELIVERABLE : 'FAILED'}${encoded ? ` (${kb}KB, ${seq.frameCount}f @ ${FPS}fps)` : ''}`);
  console.log(`render: ${seq.frameCount} frames @ ${seq.spp} spp @ ${seq.width}x${seq.height} (sky=${ENV_PRESET}, DOF f/${FSTOP}) in ${renderSecs}s`);
  console.log(`hero still: ${written.length ? path.join(ROOT, 'vehicle-city-photoreal-hero.png') : 'FAILED'}`);

  // ── assertions ────────────────────────────────────────────────────────────
  expect(seq.frameCount, 'frames rendered').toBe(FRAMES);
  expect(seq.written, 'frames written to disk').toBe(FRAMES);
  expect(written.length, 'PNG frames on disk').toBe(FRAMES);
  // every path-traced frame must be a real image (sky + scene), not a blank.
  const minBytes = Math.min(...written.map((f) => fs.statSync(path.join(seqDir, f)).size));
  expect(minBytes, 'path-traced frames are non-blank').toBeGreaterThan(20000);
  expect(encoded, 'vehicle-city-photoreal.mp4 encoded').toBeTruthy();
  expect(kb, 'deliverable mp4 non-trivial').toBeGreaterThan(0);
});
