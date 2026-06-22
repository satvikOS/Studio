// ─────────────────────────────────────────────────────────────────────────────
// STUDIO FOREST-WALK — REALTIME (no path tracer). Builds the SAME procedural
// forest + procedural biped, drives the procedural walk + wind, and captures the
// REALTIME WebGL viewport (renderer.render in a loop) over ~60-90 frames at
// 960x720. Two passes from the SAME camera/walk:
//   (A) CLAY  — every material overridden to flat grey MeshStandard.
//   (B) SHADED — normal lit materials + a procedural THREE.Sky background.
// NO imports, NO .hdr/.glb. ffmpeg hstacks A|B → forest-walk-rt-sidebyside.mp4.
// ─────────────────────────────────────────────────────────────────────────────
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(__dirname, 'shots', 'studio', 'forest');
const FRAMES = parseInt(process.env.RT_FRAMES || '72', 10);
const W = 960, H = 720;

test('Studio forest-walk REALTIME — clay | shaded side-by-side', async () => {
  test.setTimeout(20 * 60 * 1000);
  fs.mkdirSync(ROOT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js')], slowMo: 4 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) {
    win = (await app.windows()).find((w) => !w.url().startsWith('devtools://'))
      || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  }
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  win.on('console', (m) => { const t = m.text(); if (/forest|walk|nature|humanoid|RT|error|Error/i.test(t)) console.log(`[page] ${t}`); });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { try { window.localStorage.setItem('studio.v3.tour-seen', '1'); window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} }).catch(() => {});
  await win.reload().catch(() => {});
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 30000 });
  // NOTE: __studioHumanoidWalkAdvance is created lazily INSIDE __studioHumanoidWalkPath,
  // so we only require the builders + the live viewport here.
  await win.waitForFunction(() => typeof window.__studioConstructSubject === 'function'
    && typeof window.__studioHumanoidWalkPath === 'function'
    && !!window.__archdiscViewport && !!window.__archdiscViewport.renderer, { timeout: 30000 });
  await win.waitForTimeout(400);

  // ── BUILD the canonical procedural scene (forest + biped + walk). hdri may try
  //    to load a real .hdr; we pass hdri:false and add our own THREE.Sky instead.
  const build = await win.evaluate(async () => {
    const TH = window.__archdiscTHREE;
    try { if (typeof window.__studioClearScene === 'function') window.__studioClearScene(); } catch (_) {}
    const nat = await window.__studioConstructSubject('nature', {
      forest: true, terrainSize: 120, treeCount: 380, relief: 4.5,
      species: ['conifer', 'broadleaf', 'birch', 'shrub'], season: 'summer',
      seed: 653, fog: true, path: true, wind: true, hdri: false,
    });
    if (typeof window.__studioSetForestWind === 'function') window.__studioSetForestWind({ dir: [0.82, 0.57], strength: 1.15, speed: 1.0 });
    const hum = await window.__studioConstructSubject('humanoid', { height: 1.8, build: 'average', pose: 'relaxed-stand' });
    const fp = window.__studioForestPath;
    let pts;
    if (fp && typeof fp.pathAt === 'function') {
      const cz = (fp.clearing && Number.isFinite(fp.clearing.z)) ? fp.clearing.z : 0;
      let zA = Math.max(fp.zMin * 0.92, cz - 15), zB = Math.min(fp.zMax * 0.92, cz + 15);
      pts = []; for (let k = 0; k <= 7; k++) { const z = zA + (zB - zA) * (k / 7); const p = fp.pathAt(z); pts.push([p.x, 0, p.z]); }
    } else { pts = [[-6, 0, -15], [-3, 0, -8], [-1, 0, 0], [1, 0, 8], [3, 0, 15]]; }
    const walk = window.__studioHumanoidWalkPath({ path: pts, speed: 1.4, strideMeters: 0.78, plant: true });
    if (walk && typeof window.__studioHumanoidWalkAdvance === 'function') window.__studioHumanoidWalkAdvance(0);

    // count skinned + nature bodies
    const scene = window.__archdiscScene || window.__archdiscViewport.scene;
    let skinned = 0, nature = 0;
    scene.traverse((o) => { if (o && o.isSkinnedMesh) skinned++; if (o && o.userData && o.userData.archdiscStudioNature) nature++; });
    return { natureOk: nat && nat.ok, trees: nat && nat.treeCount, humOk: hum && hum.ok, bones: hum && hum.boneCount, walkOk: walk && walk.ok, skinned, nature };
  });
  console.log(`[RT] build: forest=${build.natureOk} trees=${build.trees} bodies=${build.nature} | human=${build.humOk} bones=${build.bones} skinned=${build.skinned} | walk=${build.walkOk}`);
  expect(build.natureOk).toBeTruthy();
  expect(build.skinned).toBeGreaterThan(0);
  expect(build.walkOk).toBeTruthy();

  // ── REALTIME render harness: install a per-frame render fn that (1) advances
  //    walk+wind for param u, (2) places our chase camera, (3) renderer.render,
  //    (4) reads the canvas to a dataURL. Mode toggles clay override + Sky bg.
  await win.evaluate(({ W, H }) => {
    const TH = window.__archdiscTHREE;
    const vp = window.__archdiscViewport;
    const scene = window.__archdiscScene || vp.scene;
    const renderer = vp.renderer;
    const camera = vp.camera;
    const advance = window.__studioHumanoidWalkAdvance;

    // resize renderer + camera to capture resolution
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();

    // ---- procedural THREE.Sky (shaded bg). Added once; toggled per mode. ----
    let sky = null, skyEnv = null;
    try {
      // dynamic-ish: Sky ctor may be on a global registry; fall back to gradient color.
      const SkyCtor = (window.__THREE_Sky) || null;
      if (SkyCtor) {
        sky = new SkyCtor(); sky.scale.setScalar(45000);
        const u = sky.material.uniforms;
        u.turbidity.value = 4; u.rayleigh.value = 2.2; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;
        const phi = TH.MathUtils.degToRad(90 - 14), theta = TH.MathUtils.degToRad(150);
        u.sunPosition.value.setFromSphericalCoords(1, phi, theta);
      }
    } catch (_) { sky = null; }

    // strong directional + ambient so the lit pass reads even without IBL
    const sun = new TH.DirectionalLight(0xfff0d8, 2.6);
    sun.position.set(40, 60, 30); scene.add(sun);
    const amb = new TH.HemisphereLight(0xbcd6ff, 0x3a2e22, 1.1); scene.add(amb);

    // clay override material
    const clayMat = new TH.MeshStandardMaterial({ color: 0x9a9a98, roughness: 0.95, metalness: 0.0 });

    // gradient sky fallback bg color (warm golden)
    const goldenBg = new TH.Color(0xbcd0e0);

    window.__rtSetMode = (mode) => {
      if (mode === 'clay') {
        scene.overrideMaterial = clayMat;
        scene.background = new TH.Color(0xdfe2e6);
        if (sky) sky.visible = false;
      } else {
        scene.overrideMaterial = null;
        if (sky) { if (!sky.parent) scene.add(sky); sky.visible = true; scene.background = null; }
        else scene.background = goldenBg;
      }
    };

    window.__rtRenderFrame = (u, n) => {
      const tWind = u * (n / 24) * 2.2;
      if (typeof window.__studioForestWind === 'function') window.__studioForestWind(tWind, { dir: [0.82, 0.57], strength: 1.15, speed: 1.0 });
      const fpos = (typeof advance === 'function') ? advance(u) : { x: 0, y: 0, z: 0, heading: 0 };
      const fx = fpos.x, fz = fpos.z, fy = (fpos.y || 0), heading = fpos.heading || 0;
      const fwdX = Math.sin(heading), fwdZ = Math.cos(heading);
      const behind = 5.6, side = 1.4 + Math.sin(u * Math.PI) * 1.3;
      const rX = Math.cos(heading), rZ = -Math.sin(heading);
      const eyeY = fy + 2.7 + Math.sin(u * Math.PI) * 0.25;
      const eyeX = fx - fwdX * behind + rX * side;
      const eyeZ = fz - fwdZ * behind + rZ * side;
      const tgX = fx + fwdX * 1.0, tgZ = fz + fwdZ * 1.0, tgY = fy + 1.0;
      camera.fov = 40; camera.aspect = W / H;
      camera.position.set(eyeX, eyeY, eyeZ);
      camera.up.set(0, 1, 0);
      camera.lookAt(tgX, tgY, tgZ);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    };
    return { hasSky: !!sky };
  }, { W, H }).then((r) => console.log(`[RT] harness installed, sky=${r && r.hasSky}`));

  // capture a mode
  const capture = async (mode, dirName) => {
    const dir = path.join(ROOT, dirName);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await win.evaluate((m) => window.__rtSetMode(m), mode);
    await win.waitForTimeout(150);
    for (let i = 0; i < FRAMES; i++) {
      const du = await win.evaluate(({ i, n }) => window.__rtRenderFrame(n > 1 ? i / (n - 1) : 0, n), { i, n: FRAMES });
      if (du && du.startsWith('data:image')) {
        fs.writeFileSync(path.join(dir, `frame-${String(i).padStart(4, '0')}.png`), Buffer.from(du.split(',')[1], 'base64'));
      }
      if (i % 12 === 0) console.log(`[RT][${mode}] frame ${i}/${FRAMES}`);
    }
    const got = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).length;
    console.log(`[RT][${mode}] wrote ${got} frames -> ${dir}`);
    expect(got).toBeGreaterThan(10);
  };

  await capture('shaded', 'rt-seq-shaded');
  await capture('clay', 'rt-seq-clay');

  await app.close().catch(() => {});
  console.log('[RT] DONE');
});
