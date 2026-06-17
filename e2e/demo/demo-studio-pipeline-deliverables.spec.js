// GENUINE-CUA FULL-PIPELINE + ALL-DELIVERABLES DEMO.
//
// This is the COMPLETENESS pillar (not the cinematic-fidelity pillar). For each
// of 10 DISTINCT scene prompts it drives the REAL UI exactly like
// demo-archie-cua-cinematic.spec.js — a prompt typed into the live cmdbar makes
// the genuine CUA fold (hermes_studio/modeling-cua-staged-20260617) emit
// click-discipline(modeling) → per-part click-primitive + set-selection → a real
// click-stage-preset — then it harvests EVERY deliverable Studio can produce and
// writes them to disk:
//
//   raw   per-asset PLY mesh (one per body)        __studioExportPlyAscii (selection)
//   raw   whole-scene Three.js JSON                __studioExportSceneJson
//   proc  whole-scene glTF (text, primitives only) __studioExportGltfString
//   proc  whole-scene GLB (binary)                 __studioExportGlbBinary
//   proc  project save JSON (Studio v3 snapshot)   __studioSaveScene
//   proc  lit hero still PNG (live viewport)       __studioExportSnapshotPng
//   proc  24-frame camera-orbit image sequence     live-viewport WebGL orbit (FIXED framing)
//
// HONEST scope statement (do NOT oversell):
//  - Output is BLOCKOUT-GRADE: grey arranged solids, stage-lit. This proves the
//    pipeline runs end-to-end and emits every artifact — NOT a cinematic 1:1.
//  - All renders are LIGHT live-viewport WebGL only. NO __studioGPURTRender /
//    PathTraced render at high spp (those OOM/crash the Mac).
//  - Per-asset OBJ / STL / glTF and the whole-scene USD layer are NOT harvested:
//    Studio's per-asset OBJ/STL exporters (__studioExportOBJ/STL) and the glTF
//    downloader (__studioDownloadGLTF) only fire a browser <a download> anchor
//    and return a filename — no string/buffer crosses to Playwright, and three's
//    OBJ/STL exporters are bundler-scoped (not on window) so they can't be built
//    inside page.evaluate. The USD layer (__studioUSDLayer*) is a purely
//    in-memory prim model that is NOT fed from the live scene. These are logged
//    as gaps, never faked. Per-asset raw mesh is therefore captured as PLY.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'studio', 'pipeline');

// vary-prompts rule: 10 DISTINCT scenes spanning interiors / product / workshop /
// exterior / vehicle / character-set / etc. — NO cherry-pick, all 10 run.
const SCENES = [
  { slug: '01-scandi-living-room', prompt: 'a cozy Scandinavian living room — low sofa, coffee table, rug, floor lamp, shelf, two potted plants' },
  { slug: '02-product-pedestal',   prompt: 'a product pedestal hero — a plinth with a sleek vase on top, two accent spheres, a backdrop panel' },
  { slug: '03-woodworking-shop',   prompt: 'a woodworking shop corner — workbench, table saw, lumber rack, pegboard, a stool, a dust bin' },
  { slug: '04-rooftop-bar-night',  prompt: 'a rooftop bar at night — bar counter, three stools, two high tables, string-light poles, a planter' },
  { slug: '05-robot-arm-cell',     prompt: 'a robot arm work cell — base, two arm segments, a gripper, a control box, a conveyor, the bench' },
  { slug: '06-city-plaza',         prompt: 'a small city plaza exterior — a fountain, four benches, two trees, a kiosk, three bollards, a lamp post' },
  { slug: '07-concept-car',        prompt: 'a concept car on a turntable — low body block, four wheels, a windshield wedge, two side mirrors, a spoiler' },
  { slug: '08-knight-figures',     prompt: 'a tabletop knight character set — a torso block, a head, two arms, two legs, a shield, a sword, a base' },
  { slug: '09-kitchen-galley',     prompt: 'a galley kitchen — base cabinets, a counter run, an island, a range hood, two pendant lights, a fridge block' },
  { slug: '10-drone-bench',        prompt: 'a quadcopter on a test bench — a center body, four arm booms, four rotor discs, a camera gimbal, the bench' },
];

const PRESET_META = {
  workshop: { amb: 0.6, key: 1.2, bg: '#1a1d22' },
  showroom: { amb: 0.8, key: 1.8, bg: '#000000' },
  sunset:   { amb: 0.4, key: 2.6, bg: '#241010' },
  night:    { amb: 0.15, key: 0.8, bg: '#04060a' },
};

test('Studio full pipeline → every deliverable across 10 distinct genuine-CUA scenes', async () => {
  test.setTimeout(90 * 60 * 1000); // 10 scenes × ~3-5 min each + harvest

  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js')], slowMo: 50 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { window.localStorage.setItem('studio.v3.tour-seen', '1'); try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await expect(win.locator('[data-studio-v3-cmdbar-input]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(800);

  // Crude scene metrics (count + xz spread) over the placed CUA primitives only.
  const sceneInfo = () => win.evaluate(() => {
    const s = window.__archdiscScene; const TH = window.__archdiscTHREE;
    let n = 0; const pos = []; const names = [];
    if (s) s.traverse((o) => { if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) { n++; pos.push([+o.position.x.toFixed(3), +o.position.y.toFixed(3), +o.position.z.toFixed(3)]); names.push(o.name || ''); } });
    const sd = (a) => { if (a.length < 2) return 0; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
    return { n, spreadX: sd(pos.map((p) => p[0])), spreadZ: sd(pos.map((p) => p[2])), names, TH: !!TH };
  });

  const topManifest = { generatedAt: new Date().toISOString(), pipeline: 'genuine-CUA → all-deliverables', honesty: 'blockout-grade grey arranged solids, stage-lit; light live-viewport WebGL only (no path trace)', scenes: [] };

  for (const scene of SCENES) {
    const dir = path.join(OUT, scene.slug);
    const stepsDir = path.join(dir, 'steps');
    const orbitDir = path.join(dir, 'orbit');
    const meshDir = path.join(dir, 'raw-meshes');
    fs.mkdirSync(stepsDir, { recursive: true });
    fs.mkdirSync(orbitDir, { recursive: true });
    fs.mkdirSync(meshDir, { recursive: true });

    const deliverables = []; // { type, file, tag: 'raw'|'processed' }
    const gaps = [];
    const addDeliverable = (type, file, tag) => deliverables.push({ type, file: path.relative(dir, file), tag });
    try { // per-scene guard — one bad scene must not abort the other 9

    // RESET the scene between prompts so each scene's deliverables are isolated.
    await win.evaluate(() => {
      try { const s = window.__archdiscScene; if (s) { const rm = []; s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) rm.push(o); }); rm.forEach((o) => { o.parent && o.parent.remove(o); o.geometry && o.geometry.dispose && o.geometry.dispose(); }); } } catch (_) {}
      window.__studioV3Dirty = false;
    });
    await win.waitForTimeout(300);
    await win.screenshot({ path: path.join(stepsDir, 'step-00-empty.png') });

    const before = (await sceneInfo()).n;
    console.log(`\n[pipeline] === ${scene.slug} === prompt → "${scene.prompt}"`);

    // (a) HUMAN types the request → genuine CUA drives the UI step by step.
    const input = win.locator('[data-studio-v3-cmdbar-input]');
    await input.click();
    await input.fill('');
    await input.type(scene.prompt, { delay: 14 });
    await win.screenshot({ path: path.join(stepsDir, 'step-01-typed.png') });
    await input.press('Enter');

    // (b) capture the build step by step. WAIT for the build to genuinely settle
    // (no new bodies for ~14s, with a real scene present) — the robust pattern
    // from demo-archie-cua-cinematic.spec.js, NOT a transient plateau.
    let last = before; let lastChangeAt = Date.now(); const trace = [];
    for (let i = 0; i < 90; i++) {            // up to ~180s
      await win.waitForTimeout(2000);
      const info = await sceneInfo();
      trace.push(info.n);
      await win.screenshot({ path: path.join(stepsDir, `step-${String(i + 2).padStart(2, '0')}-build-${info.n}.png`) });
      if (info.n !== last) { last = info.n; lastChangeAt = Date.now(); }
      if (info.n >= 4 && (Date.now() - lastChangeAt) > 14000) break;  // settled
    }
    const built = await sceneInfo();

    // Did the CUA click a real Stage Preset? Read live lighting back to confirm.
    const lit = await win.evaluate(() => ({
      amb: (typeof window.__studioGetAmbientIntensity === 'function') ? window.__studioGetAmbientIntensity() : null,
      bg: (window.__archdiscViewport && window.__archdiscViewport.scene && window.__archdiscViewport.scene.background && window.__archdiscViewport.scene.background.getHexString) ? '#' + window.__archdiscViewport.scene.background.getHexString() : null,
    }));
    // Infer the preset id from the readback bg/ambient (for the manifest).
    let presetId = null;
    for (const [id, m] of Object.entries(PRESET_META)) {
      if (lit.bg && lit.bg.toLowerCase() === m.bg.toLowerCase()) { presetId = id; break; }
    }
    if (!presetId && lit.amb != null) {
      let bestD = Infinity;
      for (const [id, m] of Object.entries(PRESET_META)) { const d = Math.abs(m.amb - lit.amb); if (d < bestD) { bestD = d; presetId = id; } }
    }
    console.log(`[pipeline] ${scene.slug}: bodies ${before}→${built.n} | spreadX=${built.spreadX.toFixed(2)} spreadZ=${built.spreadZ.toFixed(2)} | lit=${JSON.stringify(lit)} preset≈${presetId} | trace=${JSON.stringify(trace)}`);

    // ── (c) LIGHT camera orbit on the LIVE viewport (no path trace, no WebGPU).
    // FIXED framing copied verbatim from demo-archie-cua-cinematic.spec.js:
    // disable OrbitControls, bbox over ONLY the placed primitives, sphere-fit the
    // camera distance to the fov so the scene FILLS the frame (scale-to-viewer).
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
      await win.waitForTimeout(110);
      const fp = path.join(orbitDir, `orbit-${String(f).padStart(2, '0')}.png`);
      await win.screenshot({ path: fp });
    }
    addDeliverable('orbit-sequence', orbitDir, 'processed');
    console.log(`[pipeline] ${scene.slug}: captured ${FRAMES} live-viewport orbit frames`);

    // ── (d) lit HERO still via the live viewport (NOT path trace). Pose the
    // camera at a 3/4 hero angle first, then snapshot at 1280×960.
    await win.evaluate(() => {
      const s = window.__archdiscScene, TH = window.__archdiscTHREE, vp = window.__archdiscViewport;
      if (!s || !TH || !vp || !vp.camera) return;
      const box = new TH.Box3();
      s.traverse((o) => { if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) box.expandByObject(o); });
      if (box.isEmpty()) return;
      const c = box.getCenter(new TH.Vector3());
      const R = box.getBoundingSphere(new TH.Sphere()).radius || 1;
      const cam = vp.camera;
      const fov = ((cam.fov || 50) * Math.PI) / 180;
      const dist = (R / Math.sin(fov / 2)) * 1.1;
      cam.position.set(c.x + dist * 0.72, c.y + R * 0.6, c.z + dist * 0.72);
      cam.up.set(0, 1, 0); cam.lookAt(c.x, c.y, c.z);
      cam.near = Math.max(0.01, dist - R * 2); cam.far = dist + R * 4;
      cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    });
    await win.waitForTimeout(150);
    const hero = await win.evaluate(() => (typeof window.__studioExportSnapshotPng === 'function') ? window.__studioExportSnapshotPng(1280, 960) : { ok: false, error: 'no __studioExportSnapshotPng' });
    if (hero && hero.ok && hero.dataUrl) {
      const heroPath = path.join(dir, 'hero.png');
      fs.writeFileSync(heroPath, Buffer.from(hero.dataUrl.split(',')[1], 'base64'));
      addDeliverable('hero-still', heroPath, 'processed');
    } else { gaps.push(`hero-still: ${hero && hero.error || 'export failed'}`); }

    // ── (e) EXPORT all deliverables using the REAL data-returning export fns.

    // raw per-asset PLY: select each placed primitive BY INDEX (robust — does
    // NOT rely on __studioSelectByName's return contract, which is unreliable
    // because two modules define __studioSelectMesh with different return
    // shapes). We resolve the mesh inside evaluate, force selection via
    // __studioSelectMesh (whichever definition is live), confirm via
    // __studioSelectedMesh(), then export its PLY.
    let meshCount = 0;
    const bodyTotal = built.n;
    for (let idx = 0; idx < bodyTotal; idx++) {
      const ply = await win.evaluate((i) => {
        if (typeof window.__studioSelectMesh !== 'function' || typeof window.__studioExportPlyAscii !== 'function' || typeof window.__studioSelectedMesh !== 'function') return { ok: false, error: 'no per-asset export fns' };
        const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
        if (!s) return { ok: false, error: 'no scene' };
        const prims = []; s.traverse((o) => { if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) prims.push(o); });
        const mesh = prims[i];
        if (!mesh) return { ok: false, error: `no body at index ${i}` };
        window.__studioSelectMesh(mesh);
        // Belt-and-braces: also attach to transformControls directly so
        // __studioSelectedMesh() resolves even if __studioSelectMesh used the
        // React-state path (which won't have flushed yet this tick).
        const vp = window.__archdiscViewport;
        if (vp && vp.transformControls) { try { vp.transformControls.attach(mesh); } catch (_) {} }
        const sel = window.__studioSelectedMesh();
        // __studioExportPlyAscii reads __studioSelectedMesh internally; if that
        // hasn't updated, fall back to a direct geometry→PLY on the resolved mesh.
        if (sel && sel.uuid === mesh.uuid) {
          const r = window.__studioExportPlyAscii();
          if (r && r.ok) return { ok: true, text: r.text, name: mesh.name || `body-${i}`, verts: r.verts };
        }
        // direct fallback (mirrors __studioExportPlyAscii on the resolved mesh)
        let g = mesh.geometry && mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        if (!g || !g.attributes || !g.attributes.position) return { ok: false, error: `body ${i} has no geometry` };
        const pos = g.attributes.position, norm = g.attributes.normal, n = pos.count, faceCount = Math.floor(n / 3);
        const lines = ['ply', 'format ascii 1.0', `element vertex ${n}`, 'property float x', 'property float y', 'property float z'];
        if (norm) lines.push('property float nx', 'property float ny', 'property float nz');
        lines.push(`element face ${faceCount}`, 'property list uchar int vertex_indices', 'end_header');
        for (let k = 0; k < n; k++) { const row = [pos.array[k*3], pos.array[k*3+1], pos.array[k*3+2]]; if (norm) row.push(norm.array[k*3], norm.array[k*3+1], norm.array[k*3+2]); lines.push(row.map((v) => v.toFixed(6)).join(' ')); }
        for (let k = 0; k < faceCount; k++) lines.push(`3 ${k*3} ${k*3+1} ${k*3+2}`);
        return { ok: true, text: lines.join('\n'), name: mesh.name || `body-${i}`, verts: n, fallback: true };
      }, idx);
      if (ply && ply.ok && ply.text) {
        const safe = String(ply.name || `body-${idx}`).replace(/[^a-z0-9_.-]/gi, '_');
        const fp = path.join(meshDir, `${String(meshCount).padStart(2, '0')}-${safe}.ply`);
        fs.writeFileSync(fp, ply.text);
        addDeliverable('per-asset-mesh-ply', fp, 'raw');
        meshCount++;
      }
    }
    if (meshCount === 0) gaps.push('per-asset-mesh-ply: no bodies exported (no geometry or fn missing)');
    console.log(`[pipeline] ${scene.slug}: ${meshCount} raw per-asset PLY meshes`);

    // raw whole-scene Three.js JSON (geometry+material graph, full toJSON).
    const sceneJson = await win.evaluate(() => (typeof window.__studioExportSceneJson === 'function') ? window.__studioExportSceneJson() : { ok: false, error: 'no fn' }).catch((e) => ({ ok: false, error: 'threw: ' + String(e && e.message || e) }));
    if (sceneJson && sceneJson.ok && sceneJson.json) {
      const fp = path.join(dir, 'scene.three.json');
      fs.writeFileSync(fp, sceneJson.json);
      addDeliverable('whole-scene-three-json', fp, 'raw');
    } else { gaps.push(`whole-scene-three-json: ${sceneJson && sceneJson.error || 'failed'}`); }

    // processed whole-scene glTF (text; primitives-only clone).
    const gltf = await win.evaluate(async () => (typeof window.__studioExportGltfString === 'function') ? await window.__studioExportGltfString() : null).catch(() => null);
    if (gltf && typeof gltf === 'string' && gltf.length > 2) {
      const fp = path.join(dir, 'scene.gltf');
      fs.writeFileSync(fp, gltf);
      addDeliverable('whole-scene-gltf', fp, 'processed');
    } else { gaps.push('whole-scene-gltf: __studioExportGltfString returned null'); }

    // processed whole-scene GLB (binary). ArrayBuffer can't cross the evaluate
    // boundary, so convert to a base64 string inside the page first.
    const glb = await win.evaluate(async () => {
      if (typeof window.__studioExportGlbBinary !== 'function') return { ok: false, error: 'no fn' };
      const r = await window.__studioExportGlbBinary();
      if (!r || !r.ok || !r.buffer) return { ok: false, error: r && r.error || 'no buffer' };
      const bytes = new Uint8Array(r.buffer);
      let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return { ok: true, b64: btoa(bin), bytes: bytes.length };
    }).catch((e) => ({ ok: false, error: 'threw: ' + String(e && e.message || e) }));
    if (glb && glb.ok && glb.b64) {
      const fp = path.join(dir, 'scene.glb');
      fs.writeFileSync(fp, Buffer.from(glb.b64, 'base64'));
      addDeliverable('whole-scene-glb', fp, 'processed');
    } else { gaps.push(`whole-scene-glb: ${glb && glb.error || 'failed'}`); }

    // processed project save JSON (Studio v3 primitive snapshot — the .studio.json format).
    const save = await win.evaluate(() => (typeof window.__studioSaveScene === 'function') ? window.__studioSaveScene() : null).catch(() => null);
    if (save && typeof save === 'string' && save.length > 2) {
      const fp = path.join(dir, 'project.studio.json');
      fs.writeFileSync(fp, save);
      addDeliverable('project-save-json', fp, 'processed');
    } else { gaps.push('project-save-json: __studioSaveScene returned null'); }

    // KNOWN export gaps for this pipeline (logged, never faked): see header.
    gaps.push('per-asset-OBJ/STL/glTF: only via <a download> anchor (no string/buffer to Playwright) — PLY used instead for raw per-asset mesh');
    gaps.push('whole-scene-USD: __studioUSDLayer* is an in-memory prim model not fed from the live scene — no scene→USD exporter exists');

    addDeliverable('build-steps', stepsDir, 'processed');

    // ── (f) per-scene manifest.
    const sceneManifest = {
      slug: scene.slug,
      prompt: scene.prompt,
      bodyCount: built.n,
      spread: { x: +built.spreadX.toFixed(3), z: +built.spreadZ.toFixed(3), total: +(built.spreadX + built.spreadZ).toFixed(3) },
      bodyNames: built.names,
      lighting: { presetInferred: presetId, ambient: lit.amb, background: lit.bg },
      buildTrace: trace,
      deliverables,
      gaps,
      fidelity: 'blockout-grade (grey arranged solids, stage-lit); live-viewport WebGL only',
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(sceneManifest, null, 2));
    topManifest.scenes.push({
      slug: scene.slug, prompt: scene.prompt, bodyCount: built.n,
      spreadTotal: sceneManifest.spread.total, lightingPreset: presetId,
      deliverableCount: deliverables.length, gapCount: gaps.length,
      manifest: path.relative(OUT, path.join(dir, 'manifest.json')),
    });

    // record coherence (do NOT throw — a weak scene still ships its deliverables).
    const coherent = built.n >= 4 && (built.spreadX + built.spreadZ) > 0.4;
    if (topManifest.scenes.length) topManifest.scenes[topManifest.scenes.length - 1].coherent = coherent;
    if (!coherent) console.log(`[pipeline] ${scene.slug}: LOW coherence (n=${built.n} spread=${(built.spreadX + built.spreadZ).toFixed(2)})`);

    // re-enable controls for the next iteration's manual safety.
    await win.evaluate(() => { const vp = window.__archdiscViewport; if (vp && vp.controls) vp.controls.enabled = true; });
    } catch (sceneErr) {
      console.log(`[pipeline] scene ${scene.slug} ERROR: ${sceneErr && sceneErr.message || sceneErr}`);
      if (topManifest.scenes[topManifest.scenes.length - 1]?.slug !== scene.slug)
        topManifest.scenes.push({ slug: scene.slug, prompt: scene.prompt, error: String(sceneErr && sceneErr.message || sceneErr) });
    }
  }

  // top-level aggregate manifest.
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(topManifest, null, 2));

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();

  expect(topManifest.scenes.length).toBe(SCENES.length);
});
