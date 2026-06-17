// Throwaway: validate GPU-RT-frames-then-CPU-PT-inherits-pose end to end,
// at a modest PT size, and report how much of the PT frame is non-background.
import { test, _electron as electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test('probe-combined', async () => {
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

  for (const [id, light, seed] of [['product','product-hero',825],['living-room','golden-hour',412],['cafe','blue-hour',718]]) {
    const r = await win.evaluate(async ({ id, light, seed }) => {
      window.__studioComposeScene(id, seed);
      const m = window.__studioLookdevMaterials();
      const l = window.__studioLight(light);
      const rt = await window.__studioGPURTRender({ width: 320, height: 180, samples: 6, maxBounces: 2 });
      if (rt.dataUrl) delete rt.dataUrl;
      // PT inherits framed camera. Small PT to inspect coverage.
      const pt = window.__studioPathTraceRender({ width: 320, height: 180, samples: 12, maxBounces: 4 });
      // Coverage: decode the PT canvas pixels to estimate non-sky fraction.
      // Re-render to a canvas we can read.
      let cov = null;
      if (pt.dataUrl) {
        const img = new Image();
        await new Promise((res) => { img.onload = res; img.src = pt.dataUrl; });
        const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180;
        const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
        const d = cx.getImageData(0, 0, 320, 180).data;
        let dark = 0, bright = 0, n = 320 * 180;
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          if (lum < 30) dark++; if (lum > 200) bright++;
        }
        cov = { darkFrac: +(dark / n).toFixed(3), brightFrac: +(bright / n).toFixed(3), ptBytes: pt.dataUrl.length };
        delete pt.dataUrl;
      }
      return { id, light, mApplied: m.applied, rt: { ok: rt.ok, tri: rt.triCount, framed: rt.framed, ext: rt.sceneExtent, cam: rt.cameraPosition }, pt: { ok: pt.ok, elapsed: Math.round(pt.elapsed) }, cov };
    }, { id, light, seed });
    console.log('COMBINED ' + JSON.stringify(r));
  }
  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
