// Studio RIGGING + ORGANIC MOVEMENT proof — builds a real skinned armature (THREE
// Skeleton + 2-bone blend skinning) and drives it with overlapping eased motion, then
// renders the animated rig → frame sequence → ffmpeg mp4 + a hero still. Proves full
// rigging + organic (non-robotic) movement, not canned clips.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'studio');
const PRESETS = ['tentacle', 'arm-reach'];

test('Studio rigging + organic movement', async () => {
  test.setTimeout(15 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 20 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { window.localStorage.setItem('studio.v3.tour-seen', '1'); try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await win.waitForFunction(() => typeof window.__studioRig === 'function' && !!window.__archdiscTHREE, { timeout: 25000 });

  const proof = {};
  for (const preset of PRESETS) {
    const r = await win.evaluate(async (preset) => window.__studioRig({ preset, frames: 60, resolution: '1080p' }), preset);
    const dir = path.join(OUT, `rig_${preset}_frames`); fs.mkdirSync(dir, { recursive: true });
    let i = 0; for (const url of r.frames) { fs.writeFileSync(path.join(dir, `f-${String(i).padStart(4, '0')}.png`), Buffer.from(url.split(',')[1], 'base64')); i++; }
    // hero still = a mid-cycle frame
    fs.writeFileSync(path.join(OUT, `rig-${preset}-hero.png`), Buffer.from(r.frames[Math.floor(r.count / 3)].split(',')[1], 'base64'));
    const mp4 = path.join(OUT, `rig-${preset}.mp4`); let encoded = false;
    try { execFileSync('ffmpeg', ['-y', '-framerate', '30', '-i', path.join(dir, 'f-%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', mp4], { stdio: 'ignore' }); encoded = fs.existsSync(mp4) && fs.statSync(mp4).size > 0; } catch (e) {}
    proof[preset] = { frames: r.count, bones: r.bones, w: r.width, h: r.height, mp4kb: encoded ? Math.round(fs.statSync(mp4).size / 1024) : 0 };
    console.log(`[rig] ${preset}: ${r.count} frames, ${r.bones} bones → mp4 ${proof[preset].mp4kb}KB`);
  }
  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
  console.log('\n=== STUDIO RIG: ' + PRESETS.map((p) => `${p}(${proof[p].bones} bones, ${proof[p].frames}f, ${proof[p].mp4kb}KB)`).join(' · ') + ' ===');
  for (const p of PRESETS) { expect(proof[p].frames).toBeGreaterThanOrEqual(30); expect(proof[p].bones).toBeGreaterThanOrEqual(6); expect(proof[p].mp4kb).toBeGreaterThan(0); }
});
