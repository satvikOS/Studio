import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — SPATIAL AUDIO (headed Electron).
 *
 * Closes the Unreal MetaSounds/Wwise / Unity AudioSource gap: a positional
 * synthesized tone (Web Audio Oscillator -> Gain -> StereoPanner) anchored in
 * the scene, with the listener (camera) driving distance ATTENUATION and stereo
 * PAN. Verifies the attenuation falls off with listener distance, the pan flips
 * sign with the listener's side, a visible source gizmo is placed, and the
 * ribbon adds sources. (Synthesized tone; HRTF/occlusion/reverb out of scope.)
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-spatial-audio');

test('Studio — spatial audio source: distance attenuation + stereo pan', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioAddAudioSource === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  // a visual anchor sphere
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(200);

  // ── add a positional source at x=1; listener AT the source -> loud, then FAR -> quiet ──
  const near = await win.evaluate(() => { window.__studioAddAudioSource({ position: [1, 0, 0], freq: 330 }); return window.__studioSetListener([1, 0, 0]); });
  const far = await win.evaluate(() => window.__studioSetListener([6, 0, 0]));
  expect(near.length, 'one audio source').toBe(1);
  expect(near[0].dist, 'listener at the source -> ~0 distance').toBeLessThan(0.01);
  expect(near[0].gain, 'near gain ~= base volume').toBeGreaterThan(0.4);
  expect(far[0].gain, 'far gain is attenuated').toBeLessThan(0.2);
  expect(near[0].gain, 'attenuation: nearer is louder').toBeGreaterThan(far[0].gain);

  // ── stereo pan flips with the listener's side relative to the source ──
  const rightOfListener = await win.evaluate(() => window.__studioSetListener([-2, 0, 0])); // source (x=1) is to the listener's +x
  const leftOfListener = await win.evaluate(() => window.__studioSetListener([4, 0, 0]));  // source is to the listener's -x
  expect(rightOfListener[0].pan, 'source on the +x side pans right (>0)').toBeGreaterThan(0.1);
  expect(leftOfListener[0].pan, 'source on the -x side pans left (<0)').toBeLessThan(-0.1);

  // ── a visible source gizmo was placed in the scene ──
  const giz = await win.evaluate(() => {
    const s = window.__archdiscScene; let g = null;
    s.traverse((o) => { if (o.userData && o.userData.archdiscAudioGizmo) g = o; });
    return g ? { x: g.position.x, visible: g.visible } : null;
  });
  expect(giz, 'audio source gizmo exists').not.toBeNull();
  expect(Math.abs(giz.x - 1), 'gizmo sits at the source position').toBeLessThan(0.01);

  // ── ribbon adds another source ──
  await win.locator('[data-studio-ribbon-action="audio-source"]').click();
  await win.waitForTimeout(200);
  const total = await win.evaluate(() => window.__studioAudioState().length);
  expect(total, 'ribbon Audio Src added a second source').toBe(2);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(20, 12, 1.4); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-audio-sources.png') });

  // eslint-disable-next-line no-console
  console.log(`  spatial audio: near gain=${near[0].gain.toFixed(3)} (d=${near[0].dist.toFixed(2)}) vs far gain=${far[0].gain.toFixed(3)} (d=${far[0].dist.toFixed(2)}); pan right=${rightOfListener[0].pan.toFixed(2)} left=${leftOfListener[0].pan.toFixed(2)}; nodes=${near[0].hasNodes}; sources=${total}`);

  await app.close();
});
