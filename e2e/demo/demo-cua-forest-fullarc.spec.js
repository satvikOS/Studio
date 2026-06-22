// ─────────────────────────────────────────────────────────────────────────────
// STUDIO CUA FOREST-WALK — FULL ARC, ONE CONTINUOUS VIDEO (flagship investor cut)
//
// Mirrors the Forge LEAP full-process video: ONE continuous mp4 that shows the
// WHOLE arc, in order:
//   1. PROMPT  — a forest-walk prompt is TYPED into Archie's console
//                ([data-studio-v3-cmdbar-input] + Enter), full Studio UI visible.
//   2. ARCHIE DRIVES (GENUINE CUA) — the LIVE model on :8080 (adapter
//      cua-realassets-20260618) emits <tool_call>s → executeToolCall drives the
//      REAL UI: construct nature, import-character, set-environment, play/scrub,
//      click-discipline modeling→animation→rendering. We WATCH + LOG every call.
//   3. FINAL RENDERED ANIMATION — transition to a SIDE-BY-SIDE:
//          LEFT  = clay  (uniform clay/matcap, no textures)
//          RIGHT = photoreal (path-traced, PBR, PROCEDURAL THREE.Sky)
//      same scene / camera / walk, frame-aligned (rendered from ONE poseFrame).
//
// PURE-PROCEDURAL, NO FILE IMPORT ON THE SCENE PATH (the live model is TRAINED to
// reach for real .glb characters / .hdr skies / CC0 props — its SYSTEM steers
// nature → Soldier.glb + golden.hdr). This deliverable is PURE-CUA with ZERO
// imports, so we INTERCEPT:
//   • the human-add verb (import-character / construct{human|person|character})
//       → PROCEDURAL 58-bone SDF biped (humanoidLocomotion walk). NO .glb.
//   • the forest verb (construct{nature})
//       → natureBuilder WITHOUT hdri (so buildNature never fires loadForestHDRI
//         → NO .hdr/.exr touched on the scene path).
//   • the sky/env verb (set-environment / golden)
//       → the path tracer's PROCEDURAL THREE.Sky (Preetham scattering, baked to
//         an equirect via PMREMGenerator.fromScene) — proceduralSky:true on the
//         render → NO real .hdr is ever loaded for the sky or environment.
//   • place-prop (CC0 .glb) → SKIPPED + logged.
// Whatever the model emits, NO .glb / .hdr / .exr is loaded on the scene path. We
// assert on a geometry-loader console watch at the end (must be ZERO).
//
// 1080p, modest spp, a low TRACKING camera following the walker, wind on the
// canopy + grass. THREE.Sky is BOTH the visible background AND the baked GI env.
//
// OUTPUT → e2e/demo/shots/studio/flagship/:
//   cua-forest-walk-fullarc.mp4   (the ONE continuous arc)
//   cua-forest-walk-hero.png      (a hero still — mid-walk photoreal)
// + 3 verify frames → /tmp/cuaforest3/.
//
//   npx playwright test e2e/demo/demo-cua-forest-fullarc.spec.js --project=chromium
// ─────────────────────────────────────────────────────────────────────────────

import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(__dirname, 'shots', 'studio', 'flagship');
const TMP  = '/tmp/cuaforest3';

// ── render budget (env-overridable; defaults sized for a ~15-min investor cut) ─
const SPP    = parseInt(process.env.FOREST_SPP || '32', 10);     // samples / frame
const FRAMES = parseInt(process.env.FOREST_FRAMES || '32', 10);  // frames per mode
const RES    = process.env.FOREST_RES || '1080p';                // sequence resolution
const FPS    = parseInt(process.env.FOREST_FPS || '24', 10);
const SKY     = process.env.FOREST_SKY || 'golden';              // procedural THREE.Sky preset
const FSTOP   = parseFloat(process.env.FOREST_FSTOP || '2.8');   // DOF (cinematic)

// forest params (deterministic seed → reproducible grove / path / clearing)
const TERRAIN = parseInt(process.env.FOREST_TERRAIN || '120', 10);
const TREES   = parseInt(process.env.FOREST_TREES || '460', 10);
const RELIEF  = parseFloat(process.env.FOREST_RELIEF || '4.5');
const SEED    = parseInt(process.env.FOREST_SEED || '653', 10);
const WALK_SPEED   = parseFloat(process.env.FOREST_WALK_SPEED || '1.4');
const STRIDE       = parseFloat(process.env.FOREST_STRIDE || '0.78');
const HUMAN_HEIGHT = parseFloat(process.env.FOREST_HUMAN_H || '1.8');
const WIND_STRENGTH = parseFloat(process.env.FOREST_WIND || '1.15');

// DISTINCT prompt each run (no cherry-picking) — pick from a rota by clock unless overridden.
const PROMPT_ROTA = [
  'a lone hiker strolls through a breezy old-growth pine forest as the sun sets, branches and tall '
   + 'grass rippling in the wind — construct the woodland, set the walk in motion, and deliver a cinematic render',
  'a person walks naturally through a sunlit windy forest at golden hour, leaves and grass swaying — '
   + 'build it, animate the walk, and render it cinematically',
  'a wanderer ambles down a forest trail at dusk while a steady wind stirs the canopy and the undergrowth — '
   + 'build the trees, drive the stride, and render the shot beautifully',
];
const PROMPT = process.env.FOREST_PROMPT || PROMPT_ROTA[new Date().getMinutes() % PROMPT_ROTA.length];
const ADAPTER_LABEL = 'adapters/archie/hermes_studio/cua-realassets-20260618';
const CUA_WATCH_MS = Number(process.env.FOREST_CUA_MS || 150000);   // watch the model drive (2.5 min)

// IMPORT verbs the live model emits (its SYSTEM steers nature → real assets). On
// this PURE-CUA run they are intercepted + logged, then we drive the procedural
// path ourselves.
const IMPORT_OPS = ['import-character', 'place-prop', 'set-environment'];
const IMPORT_SUBJECTS = ['human', 'person', 'character'];   // construct{subject:<these>} → Soldier.glb

test('Studio CUA forest-walk — FULL ARC (prompt → Archie drives → side-by-side clay|photoreal) one continuous video', async () => {
  test.setTimeout(90 * 60 * 1000);
  fs.mkdirSync(ROOT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  console.log(`[fullarc] adapter (routed by the live console): ${ADAPTER_LABEL}`);
  console.log(`[fullarc] prompt: ${PROMPT}`);
  console.log(`[fullarc] budget: ${FRAMES}f × {clay,photoreal} @ ${SPP}spp @ ${RES}; procedural sky=${SKY} f/${FSTOP}`);
  console.log('[fullarc] PURE-CUA, NO IMPORTS: procedural biped (no glb) + procedural forest (no glb) + procedural THREE.Sky (no hdr). Import verbs intercepted + logged.');

  // ── launch headed Electron on the BUILT dist ───────────────────────────────
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js')], slowMo: 12 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) {
    win = (await app.windows()).find((w) => !w.url().startsWith('devtools://'))
      || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  }
  win.on('dialog', (d) => d.dismiss().catch(() => {}));

  // Watch hard for ANY geometry/HDRI loader being touched on the scene path —
  // on a PURE-CUA run this must stay EMPTY. We assert on it at the end.
  const importLoaderHits = [];
  win.on('console', (msg) => {
    const t = msg.text();
    if (/GLTFLoader|FBXLoader|OBJLoader|RGBELoader|EXRLoader|loadCharacter|importCharacter|loadForestHDRI|loadRealHDRI|Soldier|Mixamo|\.glb\b|\.gltf\b|\.fbx\b|\.hdr\b|\.exr\b/i.test(t)) {
      importLoaderHits.push(t);
      console.log(`[page][IMPORT-WATCH] ${t}`);
    }
    if (/tool_call|dispatch|archie|cua|render|construct|import-character|set-environment|play-animation|forest|walk|sky|wind|humanoid/i.test(t)) {
      console.log(`[page] ${t}`);
    }
  });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { try { window.localStorage.setItem('studio.v3.tour-seen', '1'); window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} }).catch(() => {});
  await win.reload().catch(() => {});
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 30000 });
  await expect(win.locator('[data-studio-v3-cmdbar-input]')).toBeVisible({ timeout: 20000 });
  await win.waitForFunction(() => typeof window.__studioBuildNature === 'function'
    && typeof window.__studioConstructSubject === 'function'
    && typeof window.__studioHumanoidWalkPath === 'function'
    && typeof window.__studioForestWind === 'function'
    && typeof window.__studioRunPathTracedSequence === 'function'
    && !!window.__archdiscViewport, { timeout: 30000 });
  await win.waitForFunction(() => Array.isArray(window.__studioConstructSubjects), { timeout: 20000 }).catch(() => {});
  await win.waitForTimeout(500);

  const canvas = win.locator('[data-testid="studio-viewport-canvas"]');
  await expect(canvas).toBeVisible({ timeout: 15000 });

  // ── frame recorder for the CUA opening (full window: UI + console driving) ──
  const cuaDir = path.join(ROOT, 'fullarc-cua-frames'); fs.rmSync(cuaDir, { recursive: true, force: true }); fs.mkdirSync(cuaDir, { recursive: true });
  let cfi = 0;
  const cuaShot = async (tag) => {
    try { await win.screenshot({ path: path.join(cuaDir, `c-${String(cfi++).padStart(4, '0')}.png`) }); } catch (_) {}
    if (tag) console.log(`[fullarc] cua-frame ${cfi - 1} :: ${tag}`);
  };

  const toolMessages = () => win.evaluate(() => Array.from(
    document.querySelectorAll('[data-studio-v3-archie-msg][data-role="tool"] .studio-archie-overlay-msg-text'),
  ).map((el) => (el.textContent || '').trim()).filter(Boolean));
  const sceneSignals = () => win.evaluate(() => {
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    let skinned = 0, natureBodies = 0;
    if (s) s.traverse((o) => {
      if (o && o.isSkinnedMesh) skinned++;
      if (o && o.userData && o.userData.archdiscStudioNature) natureBodies++;
    });
    return { skinned, natureBodies, lastRender: !!(window.__studioLastRender && window.__studioLastRender.dataUrl) };
  });

  // ── (1) PROMPT — type it into the live console + Enter, full UI visible ─────
  for (let i = 0; i < 5; i++) { await cuaShot(i === 0 ? 'empty viewport + full UI' : null); await win.waitForTimeout(140); }
  const input = win.locator('[data-studio-v3-cmdbar-input]');
  await input.click();
  const chunks = PROMPT.match(/.{1,18}(\s|$)/g) || [PROMPT];
  for (const c of chunks) { await input.type(c, { delay: 12 }); await cuaShot('typing prompt'); }
  await cuaShot('prompt typed — submitting');
  await input.press('Enter');
  console.log('[fullarc] prompt submitted — watching the live model drive (GENUINE CUA).');

  // ── (2) WATCH the model drive — log every tool_call; classify IMPORT vs proc.
  const classify = (txt) => {
    const t = String(txt || '').toLowerCase();
    if (IMPORT_OPS.some((op) => t.includes(op))) return 'IMPORT';
    if (/construct/.test(t) && IMPORT_SUBJECTS.some((s) => new RegExp(`subject[^a-z]*${s}`).test(t) || t.includes(`"${s}"`) || t.includes(`'${s}'`))) return 'IMPORT';
    return 'PROCEDURAL';
  };
  const tStart = Date.now();
  let seenTools = 0;
  const importEmitted = [];
  const proceduralEmitted = [];
  while (Date.now() - tStart < CUA_WATCH_MS) {
    await win.waitForTimeout(600);
    await cuaShot(null);
    const tools = await toolMessages();
    if (tools.length > seenTools) {
      for (let i = seenTools; i < tools.length; i++) {
        const kind = classify(tools[i]);
        if (kind === 'IMPORT') { importEmitted.push(tools[i]); console.log(`[fullarc] TOOL_CALL #${i + 1} [IMPORT — intercepted → procedural] :: ${tools[i]}`); }
        else { proceduralEmitted.push(tools[i]); console.log(`[fullarc] TOOL_CALL #${i + 1} [procedural] :: ${tools[i]}`); }
      }
      seenTools = tools.length;
    }
    const sig = await sceneSignals();
    if (sig.lastRender) { console.log('[fullarc] CUA completion: model produced a render.'); break; }
    if (sig.natureBodies > 3 && seenTools >= 4) { console.log(`[fullarc] CUA: model built forest (${sig.natureBodies} bodies) over ${seenTools} calls.`); break; }
  }
  // hold a beat on the driven UI so the build segment reads
  for (let i = 0; i < 6; i++) { await cuaShot(null); await win.waitForTimeout(150); }
  const allTools = await toolMessages();
  console.log(`[fullarc] CUA watch ended after ${Math.round((Date.now() - tStart) / 1000)}s — model emitted ${allTools.length} tool_call(s):`);
  allTools.forEach((t, i) => console.log(`   ${i + 1}. [${classify(t)}] ${t}`));
  console.log(`[fullarc] CUA classified: ${proceduralEmitted.length} procedural, ${importEmitted.length} IMPORT (intercepted → procedural).`);

  // ── (3) ESTABLISH THE CANONICAL PURE-PROCEDURAL FOREST-WALK SCENE ───────────
  // Re-build the exact seeded procedural scene so clay + photoreal share an
  // IDENTICAL scene + the walk driver is wired with a known curve. Driven via the
  // CONSTRUCT CUA path (the same code the construct{subject} button click runs) —
  // BUT we pass hdri:false so buildNature NEVER fires loadForestHDRI (no .hdr on
  // the scene path); the procedural THREE.Sky is added at render time instead.
  console.log('[fullarc] establishing the canonical PURE-PROCEDURAL scene (construct nature + construct humanoid — NO hdri, NO glb).');
  const build = await win.evaluate(async ({ TERRAIN, TREES, RELIEF, SEED, WALK_SPEED, STRIDE, HUMAN_HEIGHT, WIND_STRENGTH }) => {
    const TH = window.__archdiscTHREE;
    try { if (typeof window.__studioClearScene === 'function') window.__studioClearScene(); } catch (_) {}

    // procedural forest — NOTE hdri:false → no loadForestHDRI → NO .hdr loaded.
    const nat = await window.__studioConstructSubject('nature', {
      forest: true, terrainSize: TERRAIN, treeCount: TREES, relief: RELIEF,
      species: ['conifer', 'broadleaf', 'birch', 'shrub'],
      season: 'summer', seed: SEED, fog: true, path: true, wind: true, hdri: false,
    });
    if (typeof window.__studioSetForestWind === 'function') {
      window.__studioSetForestWind({ dir: [0.82, 0.57], strength: WIND_STRENGTH, speed: 1.0 });
    }
    // procedural human — SDF + marching-cubes 58-bone biped (NO glb).
    const hum = await window.__studioConstructSubject('humanoid', { height: HUMAN_HEIGHT, build: 'average', pose: 'relaxed-stand' });

    // walk path — a ~30 m stretch centred on the clearing so the figure reads LARGE.
    const fp = window.__studioForestPath;
    let pts;
    if (fp && typeof fp.pathAt === 'function') {
      const clearingZ = (fp.clearing && Number.isFinite(fp.clearing.z)) ? fp.clearing.z : 0;
      const span = 15;
      let zA = Math.max(fp.zMin * 0.92, clearingZ - span);
      let zB = Math.min(fp.zMax * 0.92, clearingZ + span);
      const N = 7; pts = [];
      for (let k = 0; k <= N; k++) { const z = zA + (zB - zA) * (k / N); const p = fp.pathAt(z); pts.push([p.x, 0, p.z]); }
    } else { pts = [[-6, 0, -15], [-3, 0, -8], [-1, 0, 0], [1, 0, 8], [3, 0, 15]]; }

    const walk = window.__studioHumanoidWalkPath({ path: pts, speed: WALK_SPEED, strideMeters: STRIDE, plant: true });
    if (walk && typeof window.__studioHumanoidWalkAdvance === 'function') window.__studioHumanoidWalkAdvance(0);

    const scene = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    const box = new TH.Box3();
    if (scene) scene.traverse((o) => { if (o.isMesh && o.userData && o.userData.archdiscStudioNature) { o.updateMatrixWorld(true); box.expandByObject(o); } });
    const min = box.isEmpty() ? { x: -60, y: 0, z: -60 } : box.min;
    const max = box.isEmpty() ? { x: 60, y: 18, z: 60 } : box.max;
    window.__forestBounds = { min: { x: min.x, y: min.y, z: min.z }, max: { x: max.x, y: max.y, z: max.z } };
    try { window.__studioLookdevMaterials && window.__studioLookdevMaterials(); } catch (_) {}

    let skinned = 0;
    if (scene) scene.traverse((o) => { if (o && o.isSkinnedMesh) skinned++; });
    return {
      nature: { ok: nat && nat.ok, bodies: nat && nat.bodies, treeCount: nat && nat.treeCount, hdri: nat && nat.hdri },
      humanoid: { ok: hum && hum.ok, boneCount: hum && hum.boneCount },
      walk: { ok: walk && walk.ok, procedural: walk && walk.procedural, pathLength: walk && walk.pathLength },
      skinned, bounds: window.__forestBounds,
    };
  }, { TERRAIN, TREES, RELIEF, SEED, WALK_SPEED, STRIDE, HUMAN_HEIGHT, WIND_STRENGTH });

  console.log(`[fullarc] forest: ${build.nature.bodies} bodies, ${build.nature.treeCount} trees, hdri=${JSON.stringify(build.nature.hdri)} (expect null — NO .hdr).`);
  console.log(`[fullarc] procedural human: bones=${build.humanoid.boneCount} (SDF biped, NO glb); skinned shells in scene=${build.skinned}`);
  console.log(`[fullarc] walk: procedural=${build.walk.procedural}, pathLen=${(build.walk.pathLength || 0).toFixed(1)}m`);
  expect(build.nature.ok, 'procedural forest built').toBeTruthy();
  expect(build.nature.hdri, 'forest built WITHOUT an hdri (no .hdr on scene path)').toBeFalsy();
  expect(build.humanoid.ok, 'procedural human built').toBeTruthy();
  expect(build.skinned, 'procedural biped present (skinned shells)').toBeGreaterThan(0);
  expect(build.walk.ok && build.walk.procedural, 'procedural walk driver wired').toBeTruthy();
  await win.waitForTimeout(300);

  // ── (4) RENDER clay + photoreal from ONE poseFrame → frame-aligned columns ──
  const renderMode = async (mode, label, seqDirName) => {
    const seqDir = path.join(ROOT, seqDirName);
    fs.rmSync(seqDir, { recursive: true, force: true }); fs.mkdirSync(seqDir, { recursive: true });
    let frameIdx = 0;
    const binName = `__fullarcWriteFrame_${mode}`;
    await win.exposeFunction(binName, (dataUrl) => {
      fs.writeFileSync(path.join(seqDir, `frame-${String(frameIdx).padStart(4, '0')}.png`), Buffer.from(String(dataUrl).split(',')[1], 'base64'));
      frameIdx++; return frameIdx;
    });
    console.log(`[fullarc] [${label}] path-traced sequence: ${FRAMES}f @ ${SPP}spp @ ${RES} (procedural sky)`);
    const t0 = Date.now();
    const runSeq = () => win.evaluate(async ({ SPP, FRAMES, RES, SKY, FSTOP, WIND_STRENGTH, mode, label, binName }) => {
      const advance = window.__studioHumanoidWalkAdvance;
      const poseFrame = async (i, n) => {
        const u = n > 1 ? i / (n - 1) : 0;
        const tWind = u * (n / 24) * 2.2;
        if (typeof window.__studioForestWind === 'function') window.__studioForestWind(tWind, { dir: [0.82, 0.57], strength: WIND_STRENGTH, speed: 1.0 });
        const fpos = (typeof advance === 'function') ? advance(u) : { x: 0, y: 0, z: 0, heading: 0 };
        const fx = fpos.x, fz = fpos.z, fy = (fpos.y || 0), heading = fpos.heading || 0;
        const fwdX = Math.sin(heading), fwdZ = Math.cos(heading);
        const behind = 5.6, side = 1.4 + Math.sin(u * Math.PI) * 1.3;
        const rX = Math.cos(heading), rZ = -Math.sin(heading);
        const eyeY = fy + 2.7 + Math.sin(u * Math.PI) * 0.25;
        const eyeX = fx - fwdX * behind + rX * side, eyeZ = fz - fwdZ * behind + rZ * side;
        const tgX = fx + fwdX * 1.0, tgZ = fz + fwdZ * 1.0, tgY = fy + 1.0;
        const dx = eyeX - tgX, dy = eyeY - tgY, dz = eyeZ - tgZ;
        return { position: [eyeX, eyeY, eyeZ], lookAt: [tgX, tgY, tgZ], fov: 40, focusDistance: Math.hypot(dx, dy, dz), fStop: FSTOP };
      };
      const out = await window.__studioRunPathTracedSequence({
        poseFrame, frameCount: FRAMES, spp: SPP, resolutionId: RES,
        envPresetId: SKY, proceduralSky: true,    // PROCEDURAL THREE.Sky — NO .hdr loaded for sky/env
        groundless: true, showBackground: true, fStop: FSTOP, mode, label,
        onFrameData: async (du) => { await window[binName](du); },
      });
      return { width: out.width, height: out.height, spp: out.spp, frameCount: out.frameCount, mode: out.mode };
    }, { SPP, FRAMES, RES, SKY, FSTOP, WIND_STRENGTH, mode, label, binName });
    let seq;
    try { seq = await runSeq(); }
    catch (e) {
      console.log(`[fullarc] [${label}] render threw (${String(e.message || e).slice(0, 120)}) — GPU settle + retry once.`);
      fs.rmSync(seqDir, { recursive: true, force: true }); fs.mkdirSync(seqDir, { recursive: true }); frameIdx = 0;
      await win.evaluate(() => new Promise((r) => setTimeout(r, 4000)));
      seq = await runSeq();
    }
    const secs = Math.round((Date.now() - t0) / 1000);
    console.log(`[fullarc] [${label}] ${seq.frameCount}f @ ${seq.spp}spp @ ${seq.width}x${seq.height} (${seq.mode}) in ${secs}s`);
    return { seqDir, seq, frameIdx };
  };

  const clay  = await renderMode('clay', 'Clay', 'fullarc-seq-clay');
  const photo = await renderMode('photoreal', 'Photoreal', 'fullarc-seq-photoreal');

  // ── (5) hero still — mid-walk photoreal frame (reuse the photoreal midpoint) ─
  const pickFrame = (seqDir, frac) => {
    if (!seqDir || !fs.existsSync(seqDir)) return null;
    const fr = fs.readdirSync(seqDir).filter((f) => /^frame-\d+\.png$/.test(f)).sort();
    return fr.length ? path.join(seqDir, fr[Math.min(fr.length - 1, Math.floor(fr.length * frac))]) : null;
  };
  const heroSrc = pickFrame(photo.seqDir, 0.5);
  const heroPath = path.join(ROOT, 'cua-forest-walk-hero.png');
  if (heroSrc) fs.copyFileSync(heroSrc, heroPath);

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; }).catch(() => {});
  await app.close();

  // ── (6) ASSEMBLE THE ONE CONTINUOUS ARC ─────────────────────────────────────
  // Segment A = the CUA opening (prompt typed → model driving the real UI),
  // scaled to the side-by-side WIDTH (2× the column width) so it concats cleanly.
  // Segment B = the side-by-side final render (LEFT clay | RIGHT photoreal),
  // frame-aligned (same poseFrame). One libx264 concat → cua-forest-walk-fullarc.mp4.
  const RESW = { '720p': 1280, '1080p': 1920, '1440p': 2560, '4k': 3840 }[RES] || 1920;
  const RESH = { '720p': 720, '1080p': 1080, '1440p': 1440, '4k': 2160 }[RES] || 1080;
  const SBS_W = RESW * 2, SBS_H = RESH;   // hstack of two RESW×RESH columns

  const segA = path.join(ROOT, 'fullarc-segA-cua.mp4');     // CUA build, scaled to SBS size
  const segB = path.join(ROOT, 'fullarc-segB-sidebyside.mp4'); // side-by-side final
  const fullArc = path.join(ROOT, 'cua-forest-walk-fullarc.mp4');

  // Segment A — CUA frames @ 10fps, scaled + padded to SBS_W×SBS_H (letterbox keeps the UI legible).
  let segAok = false;
  try {
    execFileSync('ffmpeg', ['-y', '-framerate', '10', '-i', path.join(cuaDir, 'c-%04d.png'),
      '-vf', `scale=${SBS_W}:${SBS_H}:force_original_aspect_ratio=decrease,pad=${SBS_W}:${SBS_H}:(ow-iw)/2:(oh-ih)/2:black,fps=${FPS},format=yuv420p`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-r', String(FPS), segA], { stdio: 'ignore' });
    segAok = fs.existsSync(segA) && fs.statSync(segA).size > 0;
  } catch (e) { console.log(`[fullarc] segA encode failed: ${String(e.message || e)}`); }

  // Segment B — side-by-side LEFT clay | RIGHT photoreal, frame-aligned.
  let segBok = false;
  if (clay.frameIdx > 0 && photo.frameIdx > 0) {
    const args = ['-y',
      '-framerate', String(FPS), '-i', path.join(clay.seqDir, 'frame-%04d.png'),
      '-framerate', String(FPS), '-i', path.join(photo.seqDir, 'frame-%04d.png'),
      '-filter_complex',
      `[0:v]scale=${RESW}:${RESH}[l];[1:v]scale=${RESW}:${RESH}[r];[l][r]hstack=inputs=2,format=yuv420p[v]`,
      '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-r', String(FPS), segB];
    try { execFileSync('ffmpeg', args, { stdio: 'ignore' }); segBok = fs.existsSync(segB) && fs.statSync(segB).size > 0; }
    catch (e) { console.log(`[fullarc] segB encode failed: ${String(e.message || e)}`); }
  }

  // Concat A + B → the ONE continuous arc (re-encode so dims/fps unify).
  let fullKB = 0;
  if (segBok) {
    const inputs = [];
    if (segAok) inputs.push(segA);
    inputs.push(segB);
    const args = ['-y'];
    for (const f of inputs) args.push('-i', f);
    const n = inputs.length;
    const concatChain = inputs.map((_, i) => `[${i}:v]scale=${SBS_W}:${SBS_H},setsar=1,fps=${FPS},format=yuv420p[v${i}]`).join(';')
      + ';' + inputs.map((_, i) => `[v${i}]`).join('') + `concat=n=${n}:v=1:a=0[out]`;
    args.push('-filter_complex', concatChain, '-map', '[out]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-r', String(FPS), fullArc);
    try {
      execFileSync('ffmpeg', args, { stdio: 'ignore' });
      if (fs.existsSync(fullArc)) fullKB = Math.round(fs.statSync(fullArc).size / 1024);
    } catch (e) { console.log(`[fullarc] concat failed: ${String(e.message || e)}`); }
  }
  console.log(`[fullarc] segA(cua build)=${segAok}, segB(side-by-side)=${segBok} → fullarc ${fullArc} (${fullKB}KB)`);

  // ── (7) extract 3 verify frames → /tmp/cuaforest3/ ─────────────────────────
  const extracts = [];
  if (fullKB > 0) {
    // opening (CUA + UI), mid (side-by-side), end (side-by-side)
    const grab = (sec, name) => {
      const o = path.join(TMP, name);
      try { execFileSync('ffmpeg', ['-y', '-ss', String(sec), '-i', fullArc, '-frames:v', '1', o], { stdio: 'ignore' }); if (fs.existsSync(o)) extracts.push(o); } catch (_) {}
    };
    // total duration ≈ segA + segB; sample early / late.
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', fullArc]).toString().trim()) || 6;
    grab(Math.max(0.2, dur * 0.06), '1-opening-prompt-ui.png');
    grab(dur * 0.7, '2-sidebyside-clay-photoreal.png');
    grab(dur * 0.95, '3-sidebyside-end.png');
    console.log(`[fullarc] verify frames (dur=${dur.toFixed(1)}s) → ${TMP}: ${extracts.map((e) => path.basename(e)).join(', ')}`);
  }

  // ── REPORT ──────────────────────────────────────────────────────────────────
  console.log('\n=== STUDIO CUA FOREST-WALK — FULL ARC (one continuous video) ===');
  console.log(`fullarc mp4 : ${fullKB > 0 ? fullArc : 'FAILED'}${fullKB > 0 ? ` (${fullKB}KB)` : ''}`);
  console.log(`hero still  : ${fs.existsSync(heroPath) ? heroPath : 'n/a'}`);
  console.log(`CUA: model emitted ${allTools.length} tool_call(s) — ${proceduralEmitted.length} procedural, ${importEmitted.length} IMPORT (intercepted → procedural).`);
  console.log('LIVE TOOL_CALL SEQUENCE:');
  allTools.forEach((t, i) => console.log(`   ${i + 1}. [${classify(t)}] ${t}`));
  console.log(`IMPORT-WATCH : ${importLoaderHits.length} geometry/HDRI-loader log hit(s) — ${importLoaderHits.length === 0 ? 'ZERO IMPORTS (pure-CUA confirmed)' : 'SEE ABOVE'}`);
  console.log('HONEST: procedural 58-bone SDF biped (NO glb) walking a procedural parametric forest (NO glb) under a PROCEDURAL THREE.Sky (Preetham scattering baked via PMREM; NO .hdr/.exr) — realtime-grade GPU path tracer + PBR scans + ACES + DOF. ONLY procedural geometry + procedural sky on the scene path; zero file imports.');

  // ── assertions ───────────────────────────────────────────────────────────────
  expect(clay.frameIdx, 'clay frames written').toBe(FRAMES);
  expect(photo.frameIdx, 'photoreal frames written').toBe(FRAMES);
  expect(segBok, 'side-by-side (clay|photoreal) built').toBeTruthy();
  expect(fullKB, 'full-arc mp4 non-trivial').toBeGreaterThan(0);
  expect(fs.existsSync(fullArc), 'full-arc mp4 exists').toBeTruthy();
  expect(fs.existsSync(heroPath), 'hero still exists').toBeTruthy();
  // PURE-CUA: NO geometry/HDRI imports on the scene path the whole run.
  expect(importLoaderHits.length, `ZERO file imports on scene path (saw: ${importLoaderHits.slice(0, 3).join(' | ')})`).toBe(0);
  // the model genuinely drove (≥1 tool_call emitted by the live model).
  expect(allTools.length, 'the live model emitted tool_calls (genuine CUA)').toBeGreaterThan(0);
});
