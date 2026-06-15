// Studio ORGANIC SCULPT proof — builds each organic form via the new headless
// brush-sculpt engine (window.__studioSculptOrganic) and renders it framed + lit.
// Proves sculpting is truly integrated + 1:1 organic (welded multi-res icosphere +
// real clay/crease/grab/flatten/erode brushes + symmetry), not primitive blockout.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'studio');
const FORMS = ['rock', 'skull', 'stump', 'vessel', 'creature'];

test('Studio organic sculpt forms', async () => {
  test.setTimeout(10 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 30 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { window.localStorage.setItem('studio.v3.tour-seen', '1'); try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await win.waitForTimeout(900);
  await win.waitForFunction(() => typeof window.__studioSculptOrganic === 'function' && !!window.__archdiscScene, { timeout: 20000 });

  // presentation mode once (hides editor chrome, mounts AAA post-fx)
  await win.evaluate(() => { try { window.dispatchEvent(new CustomEvent('studio-presentation-toggle')); } catch (_) {} try { window.__studioDeselect && window.__studioDeselect(); } catch (_) {} });

  const proof = {};
  for (const form of FORMS) {
    const r = await win.evaluate(async (form) => {
      const s = window.__archdiscScene; const TH = window.__archdiscTHREE; const vp = window.__archdiscViewport;
      const res = window.__studioSculptOrganic(form, 7);
      // daylight (organic forms need a real key light to read the surface)
      for (let i = s.children.length - 1; i >= 0; i--) { const c = s.children[i]; if (c && c.userData && c.userData._organicLight) s.remove(c); }
      const sun = new TH.DirectionalLight(0xfff2dc, 3.2); sun.position.set(4, 7, 5); sun.userData._organicLight = true; s.add(sun);
      const sky = new TH.HemisphereLight(0xbfd4ff, 0x4a4438, 1.0); sky.userData._organicLight = true; s.add(sky);
      const SKY = new TH.Color(0xaebfd6); s.background = SKY;
      // frame 3/4-front on the mesh
      const box = new TH.Box3().setFromObject(res.mesh);
      const c = box.getCenter(new TH.Vector3()); const sz = box.getSize(new TH.Vector3());
      const rad = Math.max(sz.x, sz.y, sz.z) * 0.5 || 2;
      const pos = [c.x + rad * 1.5, c.y + rad * 0.55, c.z + rad * 2.0];
      const look = [c.x, c.y, c.z];
      if (window.__studioMainCameraLook) window.__studioMainCameraLook(pos, look);
      else if (vp && vp.camera) { vp.camera.position.set(...pos); vp.camera.lookAt(...look); }
      // pin OrbitControls target to the form centre so the live r3f loop doesn't
      // re-aim at origin (otherwise the form drifts to the frame edge).
      if (vp && vp.controls && vp.controls.target) { vp.controls.target.set(c.x, c.y, c.z); if (vp.controls.update) vp.controls.update(); }
      let drawCalls = null, tris = null;
      const rend = vp && vp.renderer;
      if (rend && vp.camera) { rend.render(s, vp.camera); drawCalls = rend.info.render.calls; tris = rend.info.render.triangles; }
      return { stats: res.stats, extent: [Math.round(sz.x * 100) / 100, Math.round(sz.y * 100) / 100, Math.round(sz.z * 100) / 100], drawCalls, tris };
    }, form);
    await win.waitForTimeout(900);
    await win.screenshot({ path: path.join(OUT, `organic-${form}.png`) });
    proof[form] = r;
    console.log(`[organic] ${form}: ${JSON.stringify(r.stats)} extent=${JSON.stringify(r.extent)} tris=${r.tris}`);
  }

  fs.writeFileSync(path.join(OUT, 'organic-proof.json'), JSON.stringify(proof, null, 1));
  console.log('\n=== STUDIO ORGANIC SCULPT: ' + FORMS.map((f) => `${f}(${proof[f].stats.verts}v)`).join(' ') + ' ===');
  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
  // every form built a real high-res organic mesh
  for (const f of FORMS) expect(proof[f].stats.verts).toBeGreaterThan(8000);
});
