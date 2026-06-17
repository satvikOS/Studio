// Throwaway: validate the emissive-environment fix for the CPU PT (so interiors
// are lit, not black) + product-hero enlargement, across all 3 scenes at small size.
import { test, _electron as electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';
const RESULTS = [];

test('probe-fix', async () => {
  test.setTimeout(10 * 60 * 1000);
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js')], slowMo: 0 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { try { window.localStorage.setItem('studio.v3.tour-seen', '1'); } catch (_) {} try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} });
  await win.reload();
  await win.locator('[data-studio-v3-shell]').waitFor({ timeout: 25000 });
  await win.waitForFunction(() => typeof window.__studioGPURTRender === 'function' && typeof window.__studioPathTraceRender === 'function', { timeout: 25000 });

  // Install the PT-environment helper into the page.
  await win.evaluate(() => {
    // Add an emissive sky-dome + directional area emitters so the CPU path
    // tracer (which only gathers emissive + sky) lights enclosed interiors
    // and fills product scenes. Emissive panels mirror the rig key/fill/rim
    // azimuth/elevation so the lit look matches the raster/GPU-RT rig.
    window.__investorAddPTEnv = function (preset) {
      const S = window.__archdiscScene, T = window.__archdiscTHREE;
      if (!S || !T) return { ok: false };
      // remove previous PT-env emitters
      for (let i = S.children.length - 1; i >= 0; i--) { const c = S.children[i]; if (c.userData && c.userData._ptEnv) { c.geometry?.dispose?.(); S.remove(c); } }
      const box = new T.Box3().setFromObject(S);
      const ctr = box.getCenter(new T.Vector3());
      const sz = box.getSize(new T.Vector3());
      const R = Math.max(sz.x, sz.y, sz.z) || 4;
      // tone per preset (warm golden / cool blue / neutral studio)
      const sky = {
        'product-hero': [0.9, 0.93, 1.0],
        'golden-hour': [1.5, 1.15, 0.7],
        'blue-hour': [0.45, 0.6, 1.1],
        'studio-softbox': [1.0, 1.0, 1.05],
        'dramatic-noir': [0.3, 0.32, 0.4],
        'overcast': [1.0, 1.05, 1.15],
      }[preset] || [1, 1, 1];
      // Large emissive dome (inward-facing sphere) → uniform sky fill the PT gathers.
      const dome = new T.Mesh(
        new T.SphereGeometry(R * 6, 24, 16),
        new T.MeshStandardMaterial({ color: 0x000000, side: T.BackSide, emissive: new T.Color(sky[0] * 0.55, sky[1] * 0.55, sky[2] * 0.55) }),
      );
      dome.position.copy(ctr);
      dome.userData.archdiscStudioPrimitive = true; dome.userData._ptEnv = true;
      S.add(dome);
      // Bright key + fill + rim area panels (emissive boxes) at rig-like directions.
      const dir = (az, el) => { const a = az * Math.PI / 180, e = el * Math.PI / 180; return new T.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)); };
      const panels = [
        { az: -32, el: 50, i: 9, s: 1.0 }, // key
        { az: 50, el: 35, i: 3.5, s: 1.4 }, // fill (broad, dim)
        { az: 155, el: 28, i: 7, s: 0.8 }, // rim
      ];
      for (const p of panels) {
        const panel = new T.Mesh(
          new T.PlaneGeometry(R * p.s, R * p.s),
          new T.MeshStandardMaterial({ color: 0x000000, side: T.DoubleSide, emissive: new T.Color(sky[0] * p.i, sky[1] * p.i, sky[2] * p.i) }),
        );
        const d = dir(p.az, p.el).multiplyScalar(R * 2.2);
        panel.position.copy(ctr).add(d);
        panel.lookAt(ctr);
        panel.userData.archdiscStudioPrimitive = true; panel.userData._ptEnv = true;
        S.add(panel);
      }
      return { ok: true, R: +R.toFixed(2) };
    };
    // Enlarge the small product hero so it dominates the frame (scale its
    // geometry about the scene-top). Targets the gold parts sitting high up.
    window.__investorBoostProduct = function () {
      const S = window.__archdiscScene, T = window.__archdiscTHREE;
      if (!S || !T) return { ok: false };
      let n = 0;
      S.traverse((o) => {
        if (!o.isMesh || !o.userData?.archdiscStudioPrimitive || o.userData._ptEnv) return;
        const isHero = (o.userData.studioMaterial || '').includes('gold') || (o.material && o.material.metalness > 0.6);
        if (isHero) {
          o.geometry.computeBoundingBox();
          const c = o.geometry.boundingBox.getCenter(new T.Vector3());
          o.geometry.translate(-c.x, -c.y, -c.z);
          o.geometry.scale(2.6, 2.6, 2.6);
          o.geometry.translate(c.x, c.y, c.z);
          o.geometry.computeVertexNormals();
          n++;
        }
      });
      return { ok: true, boosted: n };
    };
  });

  for (const [id, light, seed] of [['product','product-hero',825],['living-room','golden-hour',412],['cafe','blue-hour',718]]) {
    const r = await win.evaluate(async ({ id, light, seed }) => {
      window.__studioComposeScene(id, seed);
      if (id === 'product') window.__investorBoostProduct();
      const m = window.__studioLookdevMaterials();
      const l = window.__studioLight(light);
      const env = window.__investorAddPTEnv(light);
      const rt = await window.__studioGPURTRender({ width: 320, height: 180, samples: 6, maxBounces: 2 });
      if (rt.dataUrl) delete rt.dataUrl;
      const pt = window.__studioPathTraceRender({ width: 320, height: 180, samples: 16, maxBounces: 5 });
      let cov = null;
      if (pt.dataUrl) {
        const img = new Image();
        await new Promise((res) => { img.onload = res; img.src = pt.dataUrl; });
        const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180;
        const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
        const d = cx.getImageData(0, 0, 320, 180).data;
        let dark = 0, bright = 0, mid = 0, n = 320 * 180;
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          if (lum < 25) dark++; else if (lum > 230) bright++; else mid++;
        }
        cov = { darkFrac: +(dark / n).toFixed(3), midFrac: +(mid / n).toFixed(3), brightFrac: +(bright / n).toFixed(3), ptBytes: pt.dataUrl.length };
        delete pt.dataUrl;
      }
      return { id, light, env, mApplied: m.applied, rt: { ok: rt.ok, tri: rt.triCount, framed: rt.framed }, pt: { ok: pt.ok, elapsed: Math.round(pt.elapsed) }, cov };
    }, { id, light, seed });
    console.log('FIX ' + JSON.stringify(r));
    RESULTS.push(r);
    fs.writeFileSync('/tmp/probe_fix_results.json', JSON.stringify(RESULTS, null, 2));
  }
  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close().catch(() => {});
});
