// Throwaway probe: confirm dist launch + API install, and measure CPU PT throughput.
import { test, _electron as electron } from '@playwright/test';
import path from 'path';

test('probe', async () => {
  test.setTimeout(8 * 60 * 1000);
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js')], slowMo: 0 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { try { window.localStorage.setItem('studio.v3.tour-seen', '1'); } catch (_) {} try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} });
  await win.reload();
  const shellOk = await win.locator('[data-studio-v3-shell]').isVisible({ timeout: 25000 }).catch(() => false);
  const apis = await win.waitForFunction(() => ({
    compose: typeof window.__studioComposeScene === 'function',
    pt: typeof window.__studioPathTraceRender === 'function',
    gpurt: typeof window.__studioGPURTRender === 'function',
    look: typeof window.__studioLookdevMaterials === 'function',
    light: typeof window.__studioLight === 'function',
    vp: !!window.__archdiscViewport,
  }), { timeout: 25000 }).then(h => h.jsonValue()).catch(() => null);

  const probe = await win.evaluate(async () => {
    const c = window.__studioComposeScene('product', 73);
    const m = window.__studioLookdevMaterials();
    const l = window.__studioLight('product-hero');
    const has = await window.__studioGPURTHasGPU();
    // GPU-RT first (frames camera onto scene internally), tiny.
    let gpu = null;
    try { gpu = await window.__studioGPURTRender({ width: 256, height: 144, samples: 4, maxBounces: 2 }); } catch (e) { gpu = { ok: false, error: String(e) }; }
    if (gpu && gpu.dataUrl) gpu.dataUrlLen = gpu.dataUrl.length, delete gpu.dataUrl;
    // CPU PT throughput probe at small size, low samples — measure rays/ms.
    const t0 = performance.now();
    let pt = null;
    try { pt = window.__studioPathTraceRender({ width: 160, height: 90, samples: 8, maxBounces: 4 }); } catch (e) { pt = { ok: false, error: String(e) }; }
    const ptMs = performance.now() - t0;
    const ptPixSamp = 160 * 90 * 8;
    if (pt && pt.dataUrl) pt.dataUrlLen = pt.dataUrl.length, delete pt.dataUrl;
    return { c, m, l, has, gpu, pt, ptMs, ptPixSamp, ptSampPerMs: ptPixSamp / ptMs };
  });

  console.log('PROBE_SHELL ' + shellOk);
  console.log('PROBE_APIS ' + JSON.stringify(apis));
  console.log('PROBE_RESULT ' + JSON.stringify(probe));
  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
