// Studio LOOK-DEV PHOTOREAL — the reference-grade final: composed scene + PBR materials,
// rendered through the GPU PATH TRACER (true GI / soft shadows / reflections) at a warm
// cinematic env. The photoreal step beyond the raster lit-final.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'studio');

test('Studio look-dev photoreal (path-traced lit final)', async () => {
  test.setTimeout(12 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 25 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { window.localStorage.setItem('studio.v3.tour-seen', '1'); try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await win.waitForFunction(() => typeof window.__studioComposeScene === 'function' && typeof window.__studioLookdevMaterials === 'function' && typeof window.__studioRunPathTracedRender === 'function', { timeout: 20000 });

  const r = await win.evaluate(async () => {
    window.__studioComposeScene('product', 7);          // hero product composition
    const applied = window.__studioLookdevMaterials().applied;   // PBR upgrade
    // path-trace at a warm cinematic env (GI + soft shadows + reflections)
    let res;
    try { res = await window.__studioRunPathTracedRender({ resolutionId: '1440p', samples: 96, envPresetId: 'golden', angle: 'hero' }); }
    catch (e) { try { res = await window.__studioRunPathTracedRender({ resolutionId: '1080p', samples: 64, envPresetId: 'golden', angle: 'hero' }); } catch (e2) { return { error: String(e2.message || e2), applied }; } }
    return { applied, w: res.width, h: res.height, samples: res.samples, dataUrl: res.dataUrl };
  });
  if (r.dataUrl) { fs.writeFileSync(path.join(OUT, 'lookdev-photoreal-final.png'), Buffer.from(r.dataUrl.split(',')[1], 'base64')); delete r.dataUrl; }
  console.log('[lookdev-pt] ' + JSON.stringify(r));
  console.log(`\n=== STUDIO LOOK-DEV PHOTOREAL: ${r.w}x${r.h} @ ${r.samples}spp, ${r.applied} PBR materials, path-traced ===`);
  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
  expect(r.w).toBeGreaterThanOrEqual(1920);
  expect(r.applied).toBeGreaterThanOrEqual(3);
});
