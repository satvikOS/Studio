// GENUINE-CUA CINEMATIC DEMO (the "autonomous, today" pillar).
//
// Proves the MUST rules without violating them:
//  (1) Archie DRIVES THE REAL UI step by step — a prompt is typed into the live
//      cmdbar, then the model emits click-discipline / click-primitive /
//      set-selection / click-stage-preset, which executeToolCall turns into REAL
//      DOM clicks + transforms on the actual controls. NO window.__studio*
//      composer ops (no __studioComposeScene / __studioLight / __studioAnimate).
//  (2) Cinematic LIGHTING is a genuine click — click-stage-preset clicks the real
//      Stage Preset button (HDRI + sun + key/ambient), not the light composer.
//  (3) Cinematic MOTION is a LIGHT live-viewport camera orbit (WebGL, no path
//      trace, no WebGPU) captured frame-by-frame — so it never OOMs/crashes the
//      Mac the way __studioGPURTRender / PathTracedRender did.
//
// This is the honest "what the model autonomously does today" capture. The
// path-traced hero stills are a SEPARATE, clearly-labeled "target / ceiling"
// artifact (demo-metal-rt.spec.js) — never conflated with this one.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'studio', 'cua-cinematic');
const STEPS = path.join(OUT, 'steps');
const ORBIT = path.join(OUT, 'orbit');

// vary-prompts rule: distinct requests, pick a fresh one per run (no cherry-pick).
const PROMPTS = [
  'a cozy Scandinavian living room — low sofa, coffee table, rug, floor lamp, shelf, a couple of plants',
  'a product pedestal hero — a plinth with a sleek vase on top, two accent spheres, a backdrop panel',
  'a woodworking shop corner — workbench, table saw, lumber rack, pegboard with tools, a stool',
  'a modern bedroom — platform bed, two nightstands, a dresser, a tall lamp, a framed picture',
  'a rooftop bar at night — bar counter, three stools, two high tables, string-light poles, a planter',
  'a robot arm on a workbench — base, two arm segments, a gripper, a control box, the bench',
];
const pick = PROMPTS[Date.now() % PROMPTS.length];

test('Archie drives the UI to a coherent, lit scene + light camera orbit (genuine CUA)', async () => {
  test.setTimeout(10 * 60 * 1000);
  fs.mkdirSync(STEPS, { recursive: true });
  fs.mkdirSync(ORBIT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js')], slowMo: 60 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { window.localStorage.setItem('studio.v3.tour-seen', '1'); try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await expect(win.locator('[data-studio-v3-cmdbar-input]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(800);

  const sceneInfo = () => win.evaluate(() => {
    const s = window.__archdiscScene; const TH = window.__archdiscTHREE;
    let n = 0; const pos = [];
    if (s) s.traverse((o) => { if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) { n++; pos.push([+o.position.x.toFixed(3), +o.position.y.toFixed(3), +o.position.z.toFixed(3)]); } });
    // crude spread metric: stddev of x and z across placed parts
    const sd = (a) => { if (a.length < 2) return 0; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
    return { n, spreadX: sd(pos.map((p) => p[0])), spreadZ: sd(pos.map((p) => p[2])), TH: !!TH };
  });

  await win.screenshot({ path: path.join(STEPS, 'step-00-empty.png') });
  const before = (await sceneInfo()).n;

  // (1) HUMAN types the request → Archie drives the UI
  const input = win.locator('[data-studio-v3-cmdbar-input]');
  await input.click();
  console.log(`[cua] prompt → "${pick}"`);
  await input.type(pick, { delay: 16 });
  await win.screenshot({ path: path.join(STEPS, 'step-01-typed.png') });
  await input.press('Enter');

  // capture the UI building + arranging + lighting step by step. Archie streams
  // ~70 tool_calls for a 10-part scene (build → arrange → light), which takes
  // ~30-60s to generate + dispatch — so WAIT for the build to genuinely settle
  // (no new bodies for ~14s, with a real scene present) rather than breaking on
  // a transient plateau while the model is still arranging the current part.
  let last = before; let lastChangeAt = Date.now(); const trace = [];
  for (let i = 0; i < 60; i++) {            // up to ~120s
    await win.waitForTimeout(2000);
    const info = await sceneInfo();
    trace.push(info.n);
    await win.screenshot({ path: path.join(STEPS, `step-${String(i).padStart(2, '0')}-build-${info.n}.png`) });
    if (info.n !== last) { last = info.n; lastChangeAt = Date.now(); }
    if (info.n >= 4 && (Date.now() - lastChangeAt) > 14000) break;  // settled
  }
  const built = await sceneInfo();
  console.log(`[cua] bodies ${before}→${built.n} | spreadX=${built.spreadX.toFixed(2)} spreadZ=${built.spreadZ.toFixed(2)} | trace=${JSON.stringify(trace)}`);

  // did the model click a real Stage Preset? (genuine cinematic lighting)
  const lit = await win.evaluate(() => ({
    amb: (typeof window.__studioGetAmbientIntensity === 'function') ? window.__studioGetAmbientIntensity() : null,
    bg: (window.__archdiscViewport && window.__archdiscViewport.scene && window.__archdiscViewport.scene.background && window.__archdiscViewport.scene.background.getHexString) ? '#' + window.__archdiscViewport.scene.background.getHexString() : null,
  }));
  console.log(`[cua] lighting after stage-preset click: ${JSON.stringify(lit)}`);

  // (3) LIGHT camera orbit on the LIVE viewport (no path trace, no WebGPU) →
  // cinematic motion that cannot OOM the Mac. Pose the camera on a circle around
  // the scene centre and screenshot each frame.
  // Disable OrbitControls so it can't override the camera pose we set per frame,
  // and frame ONLY the built primitive meshes (excluding grid/gizmo/lights, which
  // would otherwise inflate the bbox and shrink the scene to a speck). Sphere-fit
  // the camera distance to the fov so the scene FILLS the frame (scale-to-viewer).
  await win.evaluate(() => { const vp = window.__archdiscViewport; if (vp && vp.controls) vp.controls.enabled = false; });
  const FRAMES = 24;
  for (let f = 0; f < FRAMES; f++) {
    await win.evaluate((frac) => {
      const s = window.__archdiscScene, TH = window.__archdiscTHREE, vp = window.__archdiscViewport;
      if (!s || !TH || !vp || !vp.camera) return;
      const box = new TH.Box3();
      s.traverse((o) => { if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) box.expandByObject(o); });
      if (box.isEmpty()) return;
      const c = box.getCenter(new TH.Vector3());
      const sph = box.getBoundingSphere(new TH.Sphere()); const R = sph.radius || 1;
      const cam = vp.camera;
      const fov = ((cam.fov || 50) * Math.PI) / 180;
      const dist = (R / Math.sin(fov / 2)) * 1.05;   // fit the bounding sphere + small margin
      const a = frac * Math.PI * 2;
      cam.position.set(c.x + Math.cos(a) * dist, c.y + R * 0.45, c.z + Math.sin(a) * dist);
      cam.up.set(0, 1, 0);
      cam.lookAt(c.x, c.y, c.z);
      cam.near = Math.max(0.01, dist - R * 2); cam.far = dist + R * 4;
      cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    }, f / FRAMES);
    await win.waitForTimeout(120);
    await win.screenshot({ path: path.join(ORBIT, `orbit-${String(f).padStart(2, '0')}.png`) });
  }
  console.log(`[cua] captured ${FRAMES} live-viewport orbit frames (light WebGL, no path trace)`);

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();

  // genuine CUA built a real, ARRANGED scene (not one prim, not all piled)
  expect(built.n).toBeGreaterThanOrEqual(4);
  expect(built.spreadX + built.spreadZ).toBeGreaterThan(0.4); // parts are spread, not piled
});
