// VALIDATION capture (NOT the deliverable) — prove the REAL rigged human renders
// well through the fixed path tracer, so we de-risk before training + the genuine
// CUA capture. Adapted from demo-studio-flagship-city.spec.js, but it swaps the
// procedural buildHumanoid for the REAL Soldier.glb (window.__studioImportCharacter)
// running down the street under a REAL outdoor sky HDRI.
//
// What it does:
//   1) builds the procedural city (real PBR materials),
//   2) imports the REAL human — Soldier.glb, clip 'run', height 1.8 m — and drops
//      it on the carriageway centre-line (x=0), NOT the white procedural blob,
//   3) sets an OUTDOOR sky via the path tracer's envPresetId='daylight' (→ the real
//      sky-day.hdr outdoor sky); city is groundless (its own asphalt),
//   4) path-traces 8 frames @ 48 spp @ 1080p with a LOW CHASE camera framing the
//      running soldier — each frame advances the character's AnimationMixer (the run
//      cycle) AND translates it down +Z so it is mid-run, never a T-pose,
//   5) stitches the frames to _validate-real-human.mp4.
//
// Run:  cd ~/archdisc-Studio && npx playwright test e2e/demo/_validate-real-human.spec.js
//   (the frontend dist must be built first — render-flagship-photoreal.sh does the
//    vite build; or: cd frontend && npm run build)
//
// ⚠️ GPU-heavy. Do NOT run while a LoRA train / mlx serve is in flight.

import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(__dirname, 'shots', 'studio', 'flagship');

// Keep it FAST (validation, not the final): 8 frames @ 48 spp @ 1080p.
const SPP        = parseInt(process.env.VAL_SPP || '48', 10);
const FRAMES     = parseInt(process.env.VAL_FRAMES || '8', 10);
const RES        = process.env.VAL_RES || '1080p';
const FPS        = parseInt(process.env.VAL_FPS || '12', 10);
const ENV_PRESET = process.env.VAL_ENV || 'daylight';   // → real outdoor sky-day.hdr
const FSTOP      = parseFloat(process.env.VAL_FSTOP || '3.2');

test('VALIDATE — real rigged human (Soldier.glb) running through the city, path-traced', async () => {
  test.setTimeout(30 * 60 * 1000);
  fs.mkdirSync(ROOT, { recursive: true });
  const seqDir = path.join(ROOT, 'val-seq'); fs.mkdirSync(seqDir, { recursive: true });
  // clean any prior frames so we never stitch stale ones
  for (const f of fs.readdirSync(seqDir).filter((f) => /^frame-\d+\.png$/.test(f))) fs.unlinkSync(path.join(seqDir, f));

  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js')], slowMo: 10 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  win.on('console', (m) => { const t = m.text(); if (/\[val\]|error|Error|fail|HDRI|character/i.test(t)) console.log('  [page]', t); });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { try { window.localStorage.setItem('studio.v3.tour-seen', '1'); window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} }).catch(() => {});
  await win.reload().catch(() => {});
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioBuildCity === 'function'
    && typeof window.__studioImportCharacter === 'function'
    && typeof window.__studioRunPathTracedSequence === 'function'
    && !!window.__archdiscViewport, { timeout: 30000 });

  const canvas = win.locator('[data-testid="studio-viewport-canvas"]');
  await expect(canvas).toBeVisible({ timeout: 15000 });

  // ── BUILD city + import the REAL human ───────────────────────────────────────
  const build = await win.evaluate(async () => {
    const TH = window.__archdiscTHREE;
    const city = window.__studioBuildCity({ blocks: 2, seed: 1971, skyline: true });
    // REAL rigged human on the carriageway centre-line (x=0), running.
    const c = await window.__studioImportCharacter({ asset: 'soldier', clip: 'run', height: 1.8, position: [0, 0, 0] });
    // Measure the imported character's world bounds (scale + foot level check).
    let bounds = null, hasMixer = false, skinnedCount = 0, isSkinned = false;
    try {
      const g = c.group;
      g.updateMatrixWorld(true);
      hasMixer = !!(g.userData && g.userData.archdiscCharacterMixer);
      const box = new TH.Box3();
      g.traverse((o) => { if (o.isMesh) { box.expandByObject(o); if (o.isSkinnedMesh) { skinnedCount++; isSkinned = true; } } });
      if (!box.isEmpty()) {
        const sz = box.getSize(new TH.Vector3());
        const mn = box.min, mx = box.max;
        bounds = { height: sz.y, width: sz.x, depth: sz.z, minY: mn.y, maxY: mx.y };
      }
    } catch (e) { bounds = { err: String(e) }; }
    // Stash refs the per-frame closure will use.
    window.__valChar = c;
    return { city, char: { ok: c.ok, asset: c.asset, clip: c.clip, requestedClip: c.requestedClip, clips: c.clips, note: c.note, retargetNeeded: c.retargetNeeded }, bounds, hasMixer, skinnedCount, isSkinned };
  });
  console.log(`[val] city: ${JSON.stringify(build.city)}`);
  console.log(`[val] character: ${JSON.stringify(build.char)}`);
  console.log(`[val] bounds: ${JSON.stringify(build.bounds)}  hasMixer=${build.hasMixer} skinnedMeshes=${build.skinnedCount}`);
  expect(build.city && build.city.ok, 'city built').toBeTruthy();
  expect(build.char.ok, 'real character imported').toBeTruthy();
  expect(build.char.asset, 'asset is soldier (not robot fallback)').toBe('soldier');
  expect(build.char.clip, 'a clip is playing (Run)').toBeTruthy();
  expect(build.isSkinned, 'character is a SkinnedMesh (real rig)').toBeTruthy();
  expect(build.bounds && build.bounds.height, 'character ~1.8m tall').toBeGreaterThan(1.4);
  expect(build.bounds && build.bounds.height, 'character ~1.8m tall').toBeLessThan(2.3);

  await win.waitForTimeout(400);

  // ── PATH-TRACED SEQUENCE (the validation capture) ────────────────────────────
  console.log(`[val] path-traced sequence: ${FRAMES} frames @ ${SPP} spp @ ${RES}, env=${ENV_PRESET}, fStop=${FSTOP}`);
  const t0 = Date.now();
  let frameIdx = 0;
  await win.exposeFunction('__valWriteFrame', (dataUrl) => {
    const name = `frame-${String(frameIdx).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(seqDir, name), Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    frameIdx++;
    return frameIdx;
  });

  const seq = await win.evaluate(async ({ SPP, FRAMES, RES, ENV_PRESET, FSTOP }) => {
    const TH = window.__archdiscTHREE;
    const c = window.__valChar;
    const g = c.group;
    const mixer = g.userData && g.userData.archdiscCharacterMixer;
    const clipDur = (g.userData && g.userData.archdiscCharacterClipDuration) || 1;
    // run cycle: ~2.5 cycles across the 8 frames so the legs clearly move; travel
    // accumulates down +Z so the figure runs down the street (never resets).
    const STRIDE = 1.7;        // metres of +Z travel per run cycle
    const CYCLES_ACROSS = 2.5; // how many run cycles play across the whole capture
    if (g.userData) g.userData.__valBaseZ = g.position.z;
    const baseZ = (g.userData && g.userData.__valBaseZ) || 0;

    const poseFrame = async (i, n) => {
      const u = i / Math.max(1, n - 1);              // 0..1 across the capture
      // advance the run clip phase + push the figure down the street
      const phase = (u * CYCLES_ACROSS) % 1;
      if (mixer && mixer.setTime) {
        // duration: prefer the mixer's clip action duration if exposed; else 1
        let dur = 1;
        try { const a = mixer._actions && mixer._actions[0]; if (a && a._clip) dur = a._clip.duration || 1; } catch (_) {}
        mixer.setTime(phase * dur);
      }
      const travel = u * CYCLES_ACROSS * STRIDE;
      g.position.z = baseZ + travel;
      g.updateMatrixWorld(true);
      // figure centre (world) for the chase camera
      const box = new TH.Box3();
      g.traverse((o) => { if (o.isMesh) { o.updateWorldMatrix?.(true, false); box.expandByObject(o); } });
      let figureZ = g.position.z, figureY = 1.0, footY = 0;
      if (!box.isEmpty()) { const ctr = box.getCenter(new TH.Vector3()); figureZ = ctr.z; figureY = ctr.y; footY = box.min.y; }
      // LOW CHASE camera: low + slightly behind + to one side, leading the look
      // a touch ahead so the running figure dominates the frame (scale-to-viewer).
      const side   = 1.5 + Math.sin(u * Math.PI) * 0.8;
      const behind = 3.6;
      const eyeY   = footY + 1.05;                   // ~chest height of a 1.8m figure
      return {
        position: [side, eyeY, figureZ - behind],
        lookAt:   [0.0, footY + 0.95, figureZ + 1.0],
        fov: 42,
        focusDistance: Math.hypot(side, eyeY - (footY + 0.95), behind + 1.0),
        fStop: FSTOP,
      };
    };

    let written = 0;
    const out = await window.__studioRunPathTracedSequence({
      poseFrame,
      frameCount: FRAMES,
      spp: SPP,
      resolutionId: RES,
      envPresetId: ENV_PRESET,   // 'daylight' → real outdoor sky-day.hdr
      groundless: true,          // city supplies its own asphalt/streets
      showBackground: true,      // render the HDRI sky as a VISIBLE background
      fStop: FSTOP,
      onFrameData: async (du) => { written = await window.__valWriteFrame(du); },
    });
    return { width: out.width, height: out.height, spp: out.spp, frameCount: out.frameCount, written, clipDur };
  }, { SPP, FRAMES, RES, ENV_PRESET, FSTOP });
  const renderSecs = Math.round((Date.now() - t0) / 1000);
  console.log(`[val] path-traced ${seq.frameCount} frames @ ${seq.spp} spp @ ${seq.width}x${seq.height} in ${renderSecs}s (${(renderSecs / Math.max(1, seq.frameCount)).toFixed(1)}s/frame)`);

  // ── STITCH to mp4 ────────────────────────────────────────────────────────────
  const DELIVERABLE = path.join(ROOT, '_validate-real-human.mp4');
  let encoded = false;
  try {
    execFileSync('ffmpeg', ['-y', '-framerate', String(FPS), '-i', path.join(seqDir, 'frame-%04d.png'),
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', DELIVERABLE], { stdio: 'ignore' });
    encoded = fs.existsSync(DELIVERABLE) && fs.statSync(DELIVERABLE).size > 0;
  } catch (e) { console.log(`[val] ffmpeg encode failed: ${String(e.message || e)}`); }
  const kb = encoded ? Math.round(fs.statSync(DELIVERABLE).size / 1024) : 0;

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; }).catch(() => {});
  await app.close();

  const written = fs.readdirSync(seqDir).filter((f) => /^frame-\d+\.png$/.test(f)).sort();
  console.log('\n=== VALIDATE REAL HUMAN — PATH-TRACED ===');
  console.log(`mp4: ${encoded ? DELIVERABLE : 'FAILED'}${encoded ? ` (${kb}KB, ${seq.frameCount}f @ ${FPS}fps)` : ''}`);
  console.log(`frames dir: ${seqDir}  (${written.length} PNGs)`);
  console.log(`render: ${seq.frameCount}f @ ${seq.spp} spp @ ${seq.width}x${seq.height} (sky=${ENV_PRESET}) in ${renderSecs}s`);

  // ── assertions ───────────────────────────────────────────────────────────────
  expect(seq.frameCount, 'frames rendered').toBe(FRAMES);
  expect(written.length, 'PNG frames on disk').toBe(FRAMES);
  const minBytes = Math.min(...written.map((f) => fs.statSync(path.join(seqDir, f)).size));
  expect(minBytes, 'frames are non-blank').toBeGreaterThan(20000);
  expect(encoded, '_validate-real-human.mp4 encoded').toBeTruthy();
});
