// PHOTOREAL render of a DETAILED composed layout: compose (detailed furniture
// w/ named materials) → __studioLookdevMaterials (PBR) → cinematic lighting →
// __studioRunPathTracedRender (GPU path tracer, safe settings). This is the
// platform's real rendered/processed output (NOT grey blockout, NOT the minimal
// product shot). localStorage is set defensively (try/catch after load) to avoid
// the file:// SecurityError that broke the old lookdev spec.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'studio', 'photoreal');
const LAYOUT = process.env.PR_LAYOUT || 'kitchen';
const RES = process.env.PR_RES || '1080p';
const SPP = parseInt(process.env.PR_SPP || '64', 10);
const ENV = process.env.PR_ENV || 'golden';

test(`photoreal path-traced render — ${LAYOUT}`, async () => {
  test.setTimeout(12 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js')], slowMo: 20 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { try { window.localStorage.setItem('studio.v3.tour-seen', '1'); } catch (_) {} try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} }).catch(() => {});
  await win.reload().catch(() => {});
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 25000 });
  await win.waitForFunction(() => typeof window.__studioComposeScene === 'function'
    && typeof window.__studioLookdevMaterials === 'function'
    && typeof window.__studioRunPathTracedRender === 'function', { timeout: 25000 });

  const r = await win.evaluate(async ({ layout, res, spp, env }) => {
    const composed = window.__studioComposeScene(layout, 1337);
    const mats = window.__studioLookdevMaterials();
    let light = null;
    try { if (typeof window.__studioLight === 'function') light = window.__studioLight('golden-hour'); } catch (_) {}
    let out;
    try { out = await window.__studioRunPathTracedRender({ resolutionId: res, samples: spp, envPresetId: env, angle: 'hero' }); }
    catch (e) {
      try { out = await window.__studioRunPathTracedRender({ resolutionId: '720p', samples: 32, envPresetId: env, angle: 'hero' }); }
      catch (e2) { return { error: String(e2 && e2.message || e2), composed, applied: mats && mats.applied }; }
    }
    return { composed, applied: mats && mats.applied, light: light && light.preset,
             w: out.width, h: out.height, samples: out.samples, dataUrl: out.dataUrl };
  }, { layout: LAYOUT, res: RES, spp: SPP, env: ENV });

  if (r.dataUrl) {
    fs.writeFileSync(path.join(OUT, `${LAYOUT}-photoreal.png`), Buffer.from(r.dataUrl.split(',')[1], 'base64'));
    delete r.dataUrl;
  }
  console.log(`\n=== PHOTOREAL ${LAYOUT}: ${JSON.stringify(r)} ===`);
  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; }).catch(() => {});
  await app.close();

  expect(r.error, `render failed: ${r.error || ''}`).toBeFalsy();
  expect(r.applied, 'PBR materials applied').toBeGreaterThan(0);
  expect(r.w, 'rendered width').toBeGreaterThan(0);
});
