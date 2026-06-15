// 100k-instance environment PROOF — builds window.__studioBuildEnvironment at
// 100k assets, measures instance count + draw calls + build time + real-time
// raster FPS, and screenshots the live viewport. This proves the instancing
// SCALE (not the path tracer — that's for framed heroes, not 100k).
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'studio');

test('100k environment proof', async () => {
  test.setTimeout(10 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 40 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { window.localStorage.setItem('studio.v3.tour-seen', '1'); try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await win.waitForTimeout(800);

  // BUILD 100k
  const built = await win.evaluate(async () => {
    if (typeof window.__studioBuildEnvironment !== 'function') return { error: '__studioBuildEnvironment not installed' };
    const t0 = performance.now();
    let r;
    try { r = window.__studioBuildEnvironment({ preset: 'forest', count: 100000 }); }
    catch (e) { return { error: String(e && e.stack || e && e.message || e).slice(0, 500) }; }
    const buildMs = Math.round(performance.now() - t0);
    const s = window.__archdiscScene || window.__archdiscViewport?.scene;
    let instMeshes = 0, totalInst = 0;
    s.traverse((o) => { if (o.isInstancedMesh) { instMeshes++; totalInst += o.count; } });
    return { buildMs, instMeshes, totalInst, stats: r && r.stats };
  });
  console.log('[100k] build: ' + JSON.stringify(built).slice(0, 600));
  if (built.error) { console.log('[100k] BUILD FAILED'); await app.close(); throw new Error(built.error); }

  // FRAME an aerial 3/4 over the environment + measure draw calls on render
  const view = await win.evaluate(async () => {
    const s = window.__archdiscScene; const vp = window.__archdiscViewport;
    const TH = window.__archdiscTHREE;
    const box = new TH.Box3().setFromObject(s);
    const c = box.getCenter(new TH.Vector3()); const sz = box.getSize(new TH.Vector3());
    const r = Math.max(sz.x, sz.z) * 0.55;
    const pos = [c.x + r * 0.9, c.y + r * 0.6, c.z + r * 0.9];
    const look = [c.x, c.y + sz.y * 0.1, c.z];
    if (window.__studioMainCameraLook) window.__studioMainCameraLook(pos, look);
    else if (vp?.camera) { vp.camera.position.set(...pos); vp.camera.lookAt(...look); }
    // draw calls: force a render + read renderer.info
    const rend = vp?.renderer; let drawCalls = null, tris = null;
    if (rend && vp.camera) { rend.render(s, vp.camera); drawCalls = rend.info.render.calls; tris = rend.info.render.triangles; }
    return { extent: [Math.round(sz.x), Math.round(sz.y), Math.round(sz.z)], drawCalls, tris };
  });
  console.log('[100k] view: ' + JSON.stringify(view));

  await win.waitForTimeout(600);

  // FPS: count animation frames over 2s (raster real-time proxy; 60 = vsync-capped)
  const fps = await win.evaluate(() => new Promise((res) => {
    let f = 0; const t0 = performance.now();
    const loop = () => { f++; const dt = performance.now() - t0; if (dt < 2000) requestAnimationFrame(loop); else res(Math.round(f / (dt / 1000))); };
    requestAnimationFrame(loop);
  }));
  console.log('[100k] fps: ' + fps);

  await win.screenshot({ path: path.join(OUT, '100k-environment.png') });
  fs.writeFileSync(path.join(OUT, '100k-proof.json'), JSON.stringify({ ...built, ...view, fps }, null, 1));
  console.log(`\n=== 100k PROOF: ${built.totalInst} instances, ${view.drawCalls} draw calls, ${built.buildMs}ms build, ${fps} fps ===`);
  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
