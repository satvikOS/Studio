// Studio LOOK-DEV proof (track 2) — materials + cinematic lighting toward the reference
// bar. Composes a scene, renders the grey-clay BASELINE, then applies PBR materials + a
// cinematic 3-point rig (key/fill/rim, §5 ratios + Kelvin) and renders LIT FINALS. The
// before/after is the jump from "primitives at origin" to "lit + materialed + composed".
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'studio');

test('Studio look-dev — materials + cinematic lighting', async () => {
  test.setTimeout(10 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 25 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { window.localStorage.setItem('studio.v3.tour-seen', '1'); try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await win.waitForFunction(() => typeof window.__studioComposeScene === 'function' && typeof window.__studioLight === 'function' && !!window.__archdiscTHREE, { timeout: 20000 });

  const result = await win.evaluate(async () => {
    const THREE = window.__archdiscTHREE; const scene = window.__archdiscScene;
    window.__studioComposeScene('living-room', 9);
    const W = 1600, H = 900;
    const renderFrame = () => {
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
      r.setPixelRatio(1); r.setSize(W, H, false); r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1; r.outputColorSpace = THREE.SRGBColorSpace;
      const box = new THREE.Box3().setFromObject(scene); const c = box.getCenter(new THREE.Vector3()); const sz = box.getSize(new THREE.Vector3()); const R = Math.max(sz.x, sz.z, sz.y) * 0.5 || 4;
      const cam = new THREE.PerspectiveCamera(40, W / H, 0.1, R * 30); cam.position.set(c.x + R * 1.4, c.y + R * 0.7, c.z + R * 2.0); cam.lookAt(c.x, c.y + sz.y * 0.1, c.z);
      r.render(scene, cam); const url = canvas.toDataURL('image/png'); try { r.forceContextLoss(); } catch (_) {}
      return url;
    };
    // BASELINE — flat clay: strip materials to grey + one flat hemi (no rig)
    const stash = [];
    scene.traverse((o) => { if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) { stash.push([o, o.material]); o.material = new THREE.MeshStandardMaterial({ color: 0x9a9a98, roughness: 0.85 }); } });
    const flat = new THREE.HemisphereLight(0xffffff, 0x707070, 1.4); flat.userData._baseLight = true; const prevBg = scene.background; scene.background = new THREE.Color(0x202225); scene.add(flat);
    const baseline = renderFrame();
    scene.remove(flat); scene.background = prevBg; for (const [o, m] of stash) o.material = m;
    // LOOK-DEV — PBR materials + cinematic rigs
    const applied = window.__studioLookdevMaterials().applied;
    const out = { baseline, applied, finals: {} };
    for (const preset of ['product-hero', 'golden-hour', 'dramatic-noir']) {
      const rig = window.__studioLight(preset);
      out.finals[preset] = renderFrame();
    }
    return out;
  });

  fs.writeFileSync(path.join(OUT, 'lookdev-baseline.png'), Buffer.from(result.baseline.split(',')[1], 'base64'));
  for (const [preset, url] of Object.entries(result.finals)) fs.writeFileSync(path.join(OUT, `lookdev-${preset}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log(`[lookdev] materials applied: ${result.applied}; finals: ${Object.keys(result.finals).join(', ')}`);
  console.log(`\n=== STUDIO LOOK-DEV: baseline (clay) + ${Object.keys(result.finals).length} cinematic lit finals (${result.applied} PBR materials) ===`);
  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
  expect(result.applied).toBeGreaterThanOrEqual(5);
  expect(Object.keys(result.finals).length).toBe(3);
});
