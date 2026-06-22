// Studio HUMANOID LOCOMOTION proof (VIDEO deliverable) — the rigged biped walking
// and running. Builds the improved skinned humanoid (window.__studioBuildHumanoid),
// applies PBR skin/cloth materials (__studioLookdevMaterials) + a stage-preset light
// rig (__studioStage3Point) for clean illumination, frames an EYE-LEVEL camera on the
// figure, then for each cycle in [walk, run] steps the procedural gait
// (humanoidLocomotion.js: __studioHumanoidPlay / __studioHumanoidAnimate) one frame at
// a time, advancing the root forward so the figure travels across the floor while a
// camera TRACKS it, screenshotting the LIVE viewport (light WebGL, no path-trace → no
// OOM) at every frame. Each cycle's frame sequence is stitched into an mp4 with ffmpeg.
//
// This is direct rig animation (no LLM in the loop) — it is the rigged-human
// deliverable, captured as VIDEO.

import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(__dirname, 'shots', 'studio', 'locomotion');
const CYCLES = ['walk', 'run'];
const FRAMES = 48;          // frames per cycle (one full gait loop)
const STRIDE = { walk: 0.85, run: 1.7 };   // metres travelled per cycle (forward +Z)

test('Studio humanoid locomotion — walk + run (video)', async () => {
  test.setTimeout(20 * 60 * 1000);
  for (const c of CYCLES) fs.mkdirSync(path.join(ROOT, c), { recursive: true });

  // Built dist (no --dev): electron loads frontend/dist/index.html.
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js')], slowMo: 10 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { try { window.localStorage.setItem('studio.v3.tour-seen', '1'); window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} }).catch(() => {});
  await win.reload().catch(() => {});
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioBuildHumanoid === 'function'
    && typeof window.__studioHumanoidPlay === 'function'
    && typeof window.__studioHumanoidAnimate === 'function'
    && !!window.__archdiscViewport, { timeout: 30000 });

  const canvas = win.locator('[data-testid="studio-viewport-canvas"]');
  await expect(canvas).toBeVisible({ timeout: 15000 });

  // ── BUILD the improved humanoid + materials + a stage-preset light rig. Hide the
  //    grid/gizmo (presentation toggle) for a clean stage, disable OrbitControls so the
  //    per-frame tracking camera we set isn't fought, and stash the rig handle.
  const build = await win.evaluate(() => {
    const b = window.__studioBuildHumanoid({ sex: 'female', height: 1.72, pose: 'relaxed-stand' });
    // PBR skin/cloth upgrade (brief: subsurface-approx skin shell + real fabric PBR).
    // applyMaterials swaps each shell to a MeshPhysicalMaterial (skin = the
    // subsurface 'skin-warm' recipe) and STREAMS the real 4K skin/fabric scans on.
    let mats = null; try { mats = window.__studioLookdevMaterials(); } catch (_) {}
    // Warmer, slightly brighter tone-map so the skin's subsurface read isn't
    // crushed and the figure pops off the neutral stage.
    try {
      const TH = window.__archdiscTHREE, vp = window.__archdiscViewport;
      if (TH && vp && vp.renderer) {
        vp.renderer.toneMapping = TH.ACESFilmicToneMapping;
        vp.renderer.toneMappingExposure = 1.15;
        vp.renderer.outputColorSpace = TH.SRGBColorSpace;
      }
    } catch (_) {}
    // A stage-preset light rig centred on the figure's torso (~1.0 m).
    let stage = null; try { stage = window.__studioStage3Point({ target: [0, 1.0, 0], distance: 4, intensity: 1.4 }); } catch (_) {}
    // Soft ambient fill so the dark side of the figure still reads on the live WebGL.
    let groundY = 0;
    try {
      const TH = window.__archdiscTHREE, s = window.__archdiscScene;
      if (TH && s) {
        const hemi = new TH.HemisphereLight(0xffffff, 0x40444a, 0.55); hemi.userData._locoFill = true; s.add(hemi);
        // Measure the figure's foot level so the GROUND plane sits exactly under the
        // soles — this makes foot-plant (walk) and the flight phase (run) legible.
        const store = window.__studioHumanoids || {};
        const h = store[window.__studioHumanoidLast];
        const box = new TH.Box3();
        if (h) for (const sm of (h.skinnedMeshes || [])) { sm.updateMatrixWorld(true); box.expandByObject(sm); }
        groundY = box.isEmpty() ? 0 : box.min.y;
        // A large, faintly-reflective stage floor (a long runway so the figure has
        // somewhere to walk across) — kept neutral grey, no brand colour.
        const floor = new TH.Mesh(
          new TH.PlaneGeometry(40, 60),
          new TH.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.82, metalness: 0.04 }));
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(0, groundY, 10);   // extends well forward (+Z) along the travel line
        floor.receiveShadow = true;
        floor.userData._locoFloor = true;
        s.add(floor);
      }
    } catch (_) {}
    // Clean stage: drop the grid/gizmo/axes for the render.
    try { window.dispatchEvent(new Event('studio-presentation-toggle')); } catch (_) {}
    // Freeze OrbitControls — we drive the camera per frame.
    try { const vp = window.__archdiscViewport; const c = vp && vp.controls && vp.controls(); if (c) c.enabled = false; } catch (_) {}
    window.__locoGroundY = groundY;
    return { build: b, materialsApplied: mats && mats.applied, stageOk: stage && stage.ok, groundY };
  });
  console.log(`[loco] built humanoid: ${build.build.boneCount} bones, ${build.build.totalVertices} verts, height ${build.build.height} — materials ${build.materialsApplied}, stage ${build.stageOk}`);
  expect(build.build.ok, 'humanoid built').toBeTruthy();

  // ── WAIT for the real 4K skin scan + fabric maps to STREAM in (23MB albedo +
  //    28MB normal + 14MB roughness for skin alone) so the captured frames show
  //    textured skin, not the flat base tint. Poll the skin shell's material for
  //    a resolved .map; bounded so the spec never hangs.
  const texReady = await win.waitForFunction(() => {
    const store = window.__studioHumanoids || {};
    const h = store[window.__studioHumanoidLast];
    if (!h) return false;
    const skin = (h.skinnedMeshes || []).find((m) => m.userData && m.userData.archdiscStudioHumanoidShell === 'skin');
    return !!(skin && skin.material && skin.material.map && skin.material.map.image);
  }, { timeout: 60000 }).then(() => true).catch(() => false);
  const texState = await win.evaluate(() => {
    const store = window.__studioHumanoids || {};
    const h = store[window.__studioHumanoidLast];
    const out = {};
    for (const m of (h && h.skinnedMeshes) || []) {
      const k = m.userData && m.userData.archdiscStudioHumanoidShell;
      out[k] = { map: !!(m.material && m.material.map), normal: !!(m.material && m.material.normalMap), rough: !!(m.material && m.material.roughnessMap), isPhysical: m.material && m.material.isMeshPhysicalMaterial === true };
    }
    return out;
  });
  console.log(`[loco] textures ready=${texReady}  shells=${JSON.stringify(texState)}`);

  await win.waitForTimeout(600);   // let mipmaps generate + a couple frames paint

  const proof = {};
  for (const cycle of CYCLES) {
    const dir = path.join(ROOT, cycle);
    const stride = STRIDE[cycle];

    // Reset the rig to base before each cycle so travel starts from origin.
    await win.evaluate(() => { try { window.__studioHumanoidLocomotionReset(); } catch (_) {} });

    let flightFrames = 0;
    const footY = [];
    for (let i = 0; i < FRAMES; i++) {
      const t = i / FRAMES;                 // normalized phase 0..1 (one full cycle)
      const travel = stride * t;            // metres advanced so far this cycle (+Z)
      const fr = await win.evaluate(({ cycle, t, travel }) => {
        const TH = window.__archdiscTHREE;
        // 1) pose the rig at phase t (plants stance feet for walk; run leaves flight free)
        const a = window.__studioHumanoidAnimate({ cycle, t });
        // 2) travel: shift the armature + its skinned-mesh hosts forward along +Z by
        //    `travel`, ON TOP of the per-frame bob/sway the pose already applied. We use
        //    the loco base captured by Animate so we don't fight the gait root offset.
        const store = window.__studioHumanoids || {};
        const h = store[window.__studioHumanoidLast];
        let figureZ = travel, figureY = 1.0;
        if (h) {
          const arm = h.armature;
          if (!arm.userData.__locoBase) arm.userData.__locoBase = { x: arm.position.x, y: arm.position.y, z: arm.position.z };
          const base = arm.userData.__locoBase;
          // deterministic root = static base + this frame's gait offset (bob/sway/lean) + forward travel along +Z
          const gait = a && a.root ? a.root : { x: 0, y: 0, z: 0 };
          arm.position.set(base.x + (gait.x || 0), base.y + (gait.y || 0), base.z + (gait.z || 0) + travel);
          if (Array.isArray(h.skinnedMeshes)) {
            for (const sm of h.skinnedMeshes) {
              const sb = sm.userData.__locoBase || { x: sm.position.x, y: sm.position.y, z: sm.position.z };
              sm.position.set(sb.x + (gait.x || 0), sb.y + (gait.y || 0), sb.z + (gait.z || 0) + travel);
            }
          }
          arm.updateMatrixWorld(true);
          if (h.skeleton && h.skeleton.update) h.skeleton.update();
          // figure centre (torso) world position for camera tracking
          const box = new TH.Box3();
          for (const sm of (h.skinnedMeshes || [])) { sm.updateMatrixWorld(true); box.expandByObject(sm); }
          if (!box.isEmpty()) { const c = box.getCenter(new TH.Vector3()); figureZ = c.z; figureY = c.y; }
        }
        // 3) EYE-LEVEL tracking camera, framed on the figure's FRONT (so the face
        //    + textured skin read). We derive the actual facing from the HEAD
        //    bone's world forward axis (robust to any rig sign convention) and
        //    stand the camera a touch in FRONT + off to one quarter at eye height
        //    (~1.55 m), close enough that the figure DOMINATES the frame
        //    (scale-to-viewer), tracking it as it travels and aiming a hair low so
        //    both the head AND the feet/ground stay in shot.
        const vp = window.__archdiscViewport, cam = vp && vp.camera;
        let facing = 1; // +Z by default
        if (h) {
          const head = (h.boneList || []).find((b) => b.name === 'Head') || (h.boneList || []).find((b) => b.name === 'Chest');
          if (head) {
            head.updateMatrixWorld(true);
            // the head's local +Y runs up the neck; face features are pushed +Z,
            // so the world facing is the head's +Z column of its world matrix.
            const e = head.matrixWorld.elements;
            const fz = e[10]; // world Z of the local +Z axis
            facing = fz >= 0 ? 1 : -1;
          }
        }
        if (cam) {
          const gY = window.__locoGroundY || 0;
          const eyeY = gY + 1.52;                  // ~eye level
          // stand IN FRONT of the figure along its facing, off to one quarter.
          const ahead = facing * 3.1;              // distance in front (signed by facing)
          const side = 1.7;
          cam.position.set(side, eyeY, figureZ + ahead);
          cam.up.set(0, 1, 0);
          cam.lookAt(0, gY + 0.92, figureZ);       // aim at mid-torso of the travelling figure
          cam.fov = 36;                            // tight fov → figure fills more of the frame
          cam.near = 0.05; cam.far = 200;
          cam.updateProjectionMatrix(); cam.updateMatrixWorld();
        }
        return { contact: a && a.contact, flight: a && a.flight, figureZ, figureY, facing };
      }, { cycle, t, travel });

      if (fr.flight) flightFrames++;
      // sample foot world-Y from the report op for an honest plant/flight note
      footY.push(fr);

      await win.waitForTimeout(70);   // let the continuous r3f loop paint the new pose
      await canvas.screenshot({ path: path.join(dir, `frame-${String(i).padStart(2, '0')}.png`) });
    }

    // verify the frames actually wrote and are non-trivial PNGs
    const written = fs.readdirSync(dir).filter((f) => /^frame-\d+\.png$/.test(f));
    const sizes = written.map((f) => fs.statSync(path.join(dir, f)).size);
    const minSize = Math.min(...sizes);

    // stitch this cycle's frames → mp4 (24 fps, yuv420p for broad playback)
    const mp4 = path.join(ROOT, `${cycle}.mp4`);
    let encoded = false;
    try {
      execFileSync('ffmpeg', ['-y', '-framerate', '24', '-i', path.join(dir, 'frame-%02d.png'),
        // pad to even W/H — live-canvas screenshots can have an odd dimension, which
        // h264/yuv420p rejects ("height not divisible by 2").
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', mp4], { stdio: 'ignore' });
      encoded = fs.existsSync(mp4) && fs.statSync(mp4).size > 0;
    } catch (e) { console.log(`[loco] ffmpeg encode failed for ${cycle}: ${String(e.message || e)}`); }

    proof[cycle] = {
      frames: written.length,
      flightFrames,
      minPngBytes: minSize,
      mp4: encoded ? mp4 : null,
      mp4kb: encoded ? Math.round(fs.statSync(mp4).size / 1024) : 0,
    };
    console.log(`[loco] ${cycle}: ${written.length} live-viewport frames (min ${minSize}B), flight=${flightFrames} → mp4 ${proof[cycle].mp4kb}KB`);
  }

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; }).catch(() => {});
  await app.close();

  console.log('\n=== STUDIO LOCOMOTION VIDEO: '
    + CYCLES.map((c) => `${c}(${proof[c].frames}f, flight=${proof[c].flightFrames}, ${proof[c].mp4kb}KB)`).join(' · ') + ' ===');
  console.log('mp4s: ' + CYCLES.map((c) => proof[c].mp4).join(' , '));

  for (const c of CYCLES) {
    expect(proof[c].frames, `${c} frames captured`).toBe(FRAMES);
    expect(proof[c].minPngBytes, `${c} frames are non-blank`).toBeGreaterThan(2000);
    expect(proof[c].mp4kb, `${c} mp4 encoded`).toBeGreaterThan(0);
  }
  // run should have a genuine flight phase (both feet off the ground); walk should not.
  expect(proof.run.flightFrames, 'run has a flight phase').toBeGreaterThan(0);
  expect(proof.walk.flightFrames, 'walk has no flight phase').toBe(0);
});
