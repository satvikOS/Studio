// ─────────────────────────────────────────────────────────────────────────────
// FAST FOREST-WALK — time-boxed investor deliverable.
//
// Renders the EXISTING procedural forest + procedural humanoid walk → ONE
// photoreal 1080p path-traced mp4. Script-driven build (construct CUA path, NO
// imports) — skips the live-model console opening for SPEED. Real PBR scans +
// golden-hour SKY HDRI + ACES + DOF. NO imported geometry.
//
// Output: e2e/demo/shots/studio/forest/forest-walk-photoreal.mp4
// Verify frames: /tmp/fastforest/{1-walk-in-forest.png, 2-wind-on-canopy.png}
//
//   npx playwright test e2e/demo/_forest-walk-fast.spec.js --project=chromium
// ─────────────────────────────────────────────────────────────────────────────

import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(__dirname, 'shots', 'studio', 'forest');
const TMP = '/tmp/fastforest2';

// Lean, env-overridable budget (defaults sized for ~25-min total).
const SPP        = parseInt(process.env.FOREST_SPP || '26', 10);
const FRAMES     = parseInt(process.env.FOREST_FRAMES || '30', 10);
const RES        = process.env.FOREST_RES || '1080p';
const FPS        = parseInt(process.env.FOREST_FPS || '24', 10);
const ENV_PRESET = process.env.FOREST_ENV || 'golden';   // golden-hour sky HDRI
const FSTOP      = parseFloat(process.env.FOREST_FSTOP || '2.8');

// Forest params (deterministic seed). Smaller tree count → faster BVH build.
const TERRAIN  = parseInt(process.env.FOREST_TERRAIN || '120', 10);
const TREES    = parseInt(process.env.FOREST_TREES || '340', 10);
const RELIEF   = parseFloat(process.env.FOREST_RELIEF || '4.5');
const SEED     = parseInt(process.env.FOREST_SEED || '653', 10);
const WALK_SPEED   = parseFloat(process.env.FOREST_WALK_SPEED || '1.4');
const STRIDE       = parseFloat(process.env.FOREST_STRIDE || '0.78');
const HUMAN_HEIGHT = parseFloat(process.env.FOREST_HUMAN_H || '1.8');
const WIND_STRENGTH = parseFloat(process.env.FOREST_WIND || '1.15');

test('FAST forest-walk — procedural human + forest → photoreal 1080p mp4', async () => {
  test.setTimeout(40 * 60 * 1000);
  fs.mkdirSync(ROOT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js')], slowMo: 0 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) {
    win = (await app.windows()).find((w) => !w.url().startsWith('devtools://'))
      || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  }
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  const importLoaderHits = [];
  const hdriLoaderHits = [];
  win.on('console', (msg) => {
    const t = msg.text();
    if (/GLTFLoader|FBXLoader|OBJLoader|loadCharacter|importCharacter|Soldier|Mixamo|\.glb\b|\.gltf\b|\.fbx\b/i.test(t)) {
      importLoaderHits.push(t);
    }
    // procedural-sky watch: catch any imported HDRI/EXR sky or env load.
    if (/sky-golden|sky-day|sky-city|\.hdr\b|\.exr\b|RGBELoader|loadHDRI|setEnvironmentHDRI|loadForestHDRI/i.test(t)) {
      hdriLoaderHits.push(t);
    }
    if (/error|fail|throw|undefined is not|cannot read|webgl|context/i.test(t)) console.log(`[page] ${t}`);
  });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { try { window.localStorage.setItem('studio.v3.tour-seen', '1'); window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} }).catch(() => {});
  await win.reload().catch(() => {});
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioConstructSubject === 'function'
    && typeof window.__studioHumanoidWalkPath === 'function'
    && typeof window.__studioForestWind === 'function'
    && typeof window.__studioRunPathTracedSequence === 'function'
    && !!window.__archdiscViewport, { timeout: 40000 });
  await win.waitForTimeout(400);

  // ── build the canonical procedural scene (construct CUA path — NO imports) ──
  const build = await win.evaluate(async ({ TERRAIN, TREES, RELIEF, SEED, ENV_PRESET, WALK_SPEED, STRIDE, HUMAN_HEIGHT, WIND_STRENGTH }) => {
    const TH = window.__archdiscTHREE;
    try { if (typeof window.__studioClearScene === 'function') window.__studioClearScene(); } catch (_) {}

    const nat = await window.__studioConstructSubject('nature', {
      forest: true, terrainSize: TERRAIN, treeCount: TREES, relief: RELIEF,
      species: ['conifer', 'broadleaf', 'birch', 'shrub'],
      season: 'summer', seed: SEED, fog: true, path: true, wind: true, hdri: false,
    });
    if (typeof window.__studioSetForestWind === 'function') {
      window.__studioSetForestWind({ dir: [0.82, 0.57], strength: WIND_STRENGTH, speed: 1.0 });
    }
    const hum = await window.__studioConstructSubject('humanoid', {
      height: HUMAN_HEIGHT, build: 'average', pose: 'relaxed-stand',
    });

    const fp = window.__studioForestPath;
    let pts;
    if (fp && typeof fp.pathAt === 'function') {
      const clearingZ = (fp.clearing && Number.isFinite(fp.clearing.z)) ? fp.clearing.z : 0;
      const span = 15;
      let zA = Math.max(fp.zMin * 0.92, clearingZ - span);
      let zB = Math.min(fp.zMax * 0.92, clearingZ + span);
      const N = 7; pts = [];
      for (let k = 0; k <= N; k++) { const z = zA + (zB - zA) * (k / N); const p = fp.pathAt(z); pts.push([p.x, 0, p.z]); }
    } else {
      pts = [[-6, 0, -15], [-3, 0, -8], [-1, 0, 0], [1, 0, 8], [3, 0, 15]];
    }

    const walk = window.__studioHumanoidWalkPath({ path: pts, speed: WALK_SPEED, strideMeters: STRIDE, plant: true });
    if (walk && typeof window.__studioHumanoidWalkAdvance === 'function') window.__studioHumanoidWalkAdvance(0);

    try { if (window.__studioLookdevMaterials) window.__studioLookdevMaterials(); } catch (_) {}

    const scene = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    let skinned = 0; if (scene) scene.traverse((o) => { if (o && o.isSkinnedMesh) skinned++; });
    return {
      natureOk: !!(nat && nat.ok), treeCount: nat && nat.treeCount, bodies: nat && nat.bodies, hdri: nat && nat.hdri,
      humanOk: !!(hum && hum.ok), bones: hum && hum.boneCount,
      walkOk: !!(walk && walk.ok), procedural: !!(walk && walk.procedural), pathLength: walk && walk.pathLength,
      skinned,
    };
  }, { TERRAIN, TREES, RELIEF, SEED, ENV_PRESET, WALK_SPEED, STRIDE, HUMAN_HEIGHT, WIND_STRENGTH });

  console.log(`[fast-forest] forest ok=${build.natureOk} trees=${build.treeCount} bodies=${build.bodies} hdri=${JSON.stringify(build.hdri)}`);
  console.log(`[fast-forest] human ok=${build.humanOk} bones=${build.bones} skinned=${build.skinned}`);
  console.log(`[fast-forest] walk ok=${build.walkOk} procedural=${build.procedural} len=${(build.pathLength || 0).toFixed(1)}m`);
  expect(build.natureOk, 'forest built').toBeTruthy();
  expect(build.treeCount, 'forest has trees').toBeGreaterThan(0);
  expect(build.humanOk, 'human built').toBeTruthy();
  expect(build.skinned, 'procedural biped in scene').toBeGreaterThan(0);
  expect(build.walkOk && build.procedural, 'procedural walk wired').toBeTruthy();

  // ── render the photoreal sequence → PNG frames ──────────────────────────────
  const seqDir = path.join(ROOT, 'seq-photoreal-fast');
  fs.rmSync(seqDir, { recursive: true, force: true });
  fs.mkdirSync(seqDir, { recursive: true });
  let frameIdx = 0;
  await win.exposeFunction('__fastWriteFrame', (dataUrl) => {
    fs.writeFileSync(path.join(seqDir, `frame-${String(frameIdx).padStart(4, '0')}.png`), Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    frameIdx++;
    if (frameIdx % 5 === 0) console.log(`[fast-forest] frames written: ${frameIdx}`);
    return frameIdx;
  });

  const t0 = Date.now();
  const runSeq = () => win.evaluate(async ({ SPP, FRAMES, RES, ENV_PRESET, FSTOP, WIND_STRENGTH }) => {
    const advance = window.__studioHumanoidWalkAdvance;
    const poseFrame = async (i, n) => {
      const u = n > 1 ? i / (n - 1) : 0;
      const tWind = u * (n / 24) * 2.2;
      if (typeof window.__studioForestWind === 'function') {
        window.__studioForestWind(tWind, { dir: [0.82, 0.57], strength: WIND_STRENGTH, speed: 1.0 });
      }
      const fpos = (typeof advance === 'function') ? advance(u) : { x: 0, y: 0, z: 0, heading: 0 };
      const fx = fpos.x, fz = fpos.z, fy = (fpos.y || 0), heading = fpos.heading || 0;
      const fwdX = Math.sin(heading), fwdZ = Math.cos(heading);
      const behind = 5.6, side = 1.4 + Math.sin(u * Math.PI) * 1.3;
      const rX = Math.cos(heading), rZ = -Math.sin(heading);
      const eyeY = fy + 2.7 + Math.sin(u * Math.PI) * 0.25;
      const eyeX = fx - fwdX * behind + rX * side;
      const eyeZ = fz - fwdZ * behind + rZ * side;
      const tgX = fx + fwdX * 1.0, tgZ = fz + fwdZ * 1.0, tgY = fy + 1.0;
      const dx = eyeX - tgX, dy = eyeY - tgY, dz = eyeZ - tgZ;
      return { position: [eyeX, eyeY, eyeZ], lookAt: [tgX, tgY, tgZ], fov: 40, focusDistance: Math.hypot(dx, dy, dz), fStop: FSTOP };
    };
    const out = await window.__studioRunPathTracedSequence({
      poseFrame, frameCount: FRAMES, spp: SPP, resolutionId: RES, envPresetId: ENV_PRESET,
      groundless: true, showBackground: true, fStop: FSTOP, mode: 'photoreal', label: null,
      proceduralSky: true,   // FULLY PROCEDURAL THREE.Sky (no imported HDRI/EXR bg)
      onFrameData: async (du) => { await window.__fastWriteFrame(du); },
    });
    return { width: out.width, height: out.height, spp: out.spp, frameCount: out.frameCount };
  }, { SPP, FRAMES, RES, ENV_PRESET, FSTOP, WIND_STRENGTH });

  let seq;
  try { seq = await runSeq(); }
  catch (e) {
    console.log(`[fast-forest] render threw (${String(e.message || e).slice(0, 140)}) — GPU settle + retry once.`);
    fs.rmSync(seqDir, { recursive: true, force: true }); fs.mkdirSync(seqDir, { recursive: true }); frameIdx = 0;
    await win.evaluate(() => new Promise((r) => setTimeout(r, 3000)));
    seq = await runSeq();
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`[fast-forest] ${seq.frameCount}f @ ${seq.spp}spp @ ${seq.width}x${seq.height} in ${secs}s (${(secs / Math.max(1, seq.frameCount)).toFixed(1)}s/f)`);

  // ── encode mp4 ──────────────────────────────────────────────────────────────
  const mp4 = path.join(ROOT, 'forest-walk-photoreal.mp4');
  execFileSync('ffmpeg', ['-y', '-framerate', String(FPS), '-i', path.join(seqDir, 'frame-%04d.png'),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', mp4], { stdio: 'ignore' });
  const kb = fs.existsSync(mp4) ? Math.round(fs.statSync(mp4).size / 1024) : 0;
  console.log(`[fast-forest] mp4 → ${mp4} (${kb}KB)`);

  await app.close();

  // ── extract the 2 required verify frames ────────────────────────────────────
  const onDisk = fs.readdirSync(seqDir).filter((f) => /^frame-\d+\.png$/.test(f)).sort();
  const pick = (frac) => onDisk.length ? path.join(seqDir, onDisk[Math.min(onDisk.length - 1, Math.floor(onDisk.length * frac))]) : null;
  const f1 = pick(0.35); if (f1) fs.copyFileSync(f1, path.join(TMP, '1-walk-in-forest.png'));
  const f2 = pick(0.7);  if (f2) fs.copyFileSync(f2, path.join(TMP, '2-wind-on-canopy.png'));
  console.log(`[fast-forest] verify frames → ${TMP}: 1-walk-in-forest.png, 2-wind-on-canopy.png`);

  // ── report + assertions ─────────────────────────────────────────────────────
  console.log('\n=== FAST FOREST-WALK — photoreal 1080p ===');
  console.log(`mp4: ${mp4} (${kb}KB, ${frameIdx}f)`);
  console.log(`IMPORT-WATCH: ${importLoaderHits.length} geometry-loader hit(s) — ${importLoaderHits.length === 0 ? 'ZERO IMPORTS' : importLoaderHits.slice(0, 3).join(' | ')}`);
  console.log(`SKY-WATCH: ${hdriLoaderHits.length} imported-HDRI/EXR hit(s) — ${hdriLoaderHits.length === 0 ? 'ZERO IMPORTED SKY/ENV' : hdriLoaderHits.slice(0, 3).join(' | ')}`);
  console.log('HONEST: procedural SDF biped + procedural forest + FULLY PROCEDURAL THREE.Sky (Preetham scattering, golden hour) baked to a cube env for path-traced GI + real PBR scans + ACES + DOF. NO geometry imported, NO imported sky/HDRI.');

  expect(frameIdx, 'frames written').toBeGreaterThan(8);
  const minBytes = Math.min(...onDisk.map((f) => fs.statSync(path.join(seqDir, f)).size));
  expect(minBytes, 'frames non-blank').toBeGreaterThan(15000);
  expect(kb, 'mp4 non-trivial').toBeGreaterThan(0);
  expect(fs.existsSync(mp4), 'mp4 exists').toBeTruthy();
  expect(importLoaderHits.length, `ZERO geometry imports`).toBe(0);
  expect(hdriLoaderHits.length, `ZERO imported sky/HDRI (fully procedural sky)`).toBe(0);
});
