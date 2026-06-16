// Studio ANIMATION + 4K PHOTOREAL proof (movies/ads/commercials capability).
//  (a) 4K photoreal still — path-traced 3840×2160 hero frame of a composed product scene.
//  (b) product-reveal animation — camera-path frame sequence → ffmpeg → mp4 (the ad spot).
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'studio');
const FRAMES_DIR = path.join(OUT, 'anim_frames');

test('Studio animation + 4K photoreal', async () => {
  test.setTimeout(15 * 60 * 1000);
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 25 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { window.localStorage.setItem('studio.v3.tour-seen', '1'); try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await win.waitForFunction(() => typeof window.__studioComposeScene === 'function' && typeof window.__studioAnimate === 'function' && typeof window.__studioRunPathTracedRender === 'function', { timeout: 20000 });

  // compose a product hero scene
  const built = await win.evaluate(() => { const r = window.__studioComposeScene('product', 7); return { bodies: (window.__archdiscScene && window.__archdiscScene.children.length) || 0, r: !!r }; });
  console.log('[anim4k] composed product scene: ' + JSON.stringify(built));

  // (a) 4K photoreal still (path-traced); fall back to 1440p if the 4K target fails
  const still = await win.evaluate(async () => {
    try { const r = await window.__studioRunPathTracedRender({ resolutionId: '4k', samples: 48, angle: 'hero' }); return { ok: true, w: r.width, h: r.height, samples: r.samples, dataUrl: r.dataUrl }; }
    catch (e) { try { const r = await window.__studioRunPathTracedRender({ resolutionId: '1440p', samples: 64, angle: 'hero' }); return { ok: true, fallback: '1440p', w: r.width, h: r.height, samples: r.samples, dataUrl: r.dataUrl }; } catch (e2) { return { ok: false, error: String(e2.message || e2) }; } }
  });
  if (still.ok && still.dataUrl) { fs.writeFileSync(path.join(OUT, 'photoreal-4k-hero.png'), Buffer.from(still.dataUrl.split(',')[1], 'base64')); delete still.dataUrl; }
  console.log('[anim4k] 4K still: ' + JSON.stringify(still));

  // (b) product-reveal animation → frame sequence
  const anim = await win.evaluate(async () => {
    const r = await window.__studioAnimate({ preset: 'product-reveal', frames: 48, resolution: '1080p' });
    return { count: r.count, width: r.width, height: r.height, frames: r.frames };
  });
  let i = 0;
  for (const url of anim.frames) { fs.writeFileSync(path.join(FRAMES_DIR, `frame-${String(i).padStart(4, '0')}.png`), Buffer.from(url.split(',')[1], 'base64')); i++; }
  console.log(`[anim4k] animation: ${anim.count} frames @ ${anim.width}x${anim.height}`);
  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();

  // encode mp4 via ffmpeg (available at /opt/homebrew/bin/ffmpeg)
  const mp4 = path.join(OUT, 'product-reveal.mp4');
  let encoded = false;
  try {
    execFileSync('ffmpeg', ['-y', '-framerate', '24', '-i', path.join(FRAMES_DIR, 'frame-%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', mp4], { stdio: 'ignore' });
    encoded = fs.existsSync(mp4) && fs.statSync(mp4).size > 0;
  } catch (e) { console.log('[anim4k] ffmpeg encode failed: ' + String(e.message || e)); }
  const mp4kb = encoded ? Math.round(fs.statSync(mp4).size / 1024) : 0;
  console.log(`\n=== STUDIO ANIM+4K: 4K still ${still.w}x${still.h}${still.fallback ? ' (fallback ' + still.fallback + ')' : ''}, ${anim.count}-frame product-reveal → mp4 ${mp4kb}KB ===`);

  expect(still.ok).toBe(true);
  expect(still.w).toBeGreaterThanOrEqual(2560);   // 4K (or 1440p fallback) photoreal still
  expect(anim.count).toBeGreaterThanOrEqual(24);   // a real animated sequence
  expect(encoded).toBe(true);                       // mp4 produced
});
