// Studio V3 — audio system + waveform timeline.
//
// Headed Mac-Electron spec for the
// frontend/src/workbenches/studio/v3/audio/* family. We can't ship a
// real audio file inside the repo (binary noise + license headaches),
// so the test drives the system through the same back door real users
// would hit anyway: synthesise a sine tone via the
// __studioAudioGenerateSineWave op, then exercise load → waveform
// render → transport → animation sync.
//
// Coverage:
//   • side-effect-import audio/autoload.js so the op surface lights up
//     even when api.js orchestration hasn't wired us in yet
//   • generate two sine-wave clips (different freq/duration)
//   • __studioAudioList reports both clips with the right metadata
//   • __studioAudioRenderWaveform returns a non-empty PNG data URL +
//     the right size + a non-zero peak
//   • load a WAV via the data-URL path (synthesised in-page, bytes
//     hand-rolled into a RIFF container)
//   • __studioAudioPlay → wait → __studioAudioGetCurrentTime advances
//   • __studioAudioPause halts the play head + sets playing=false
//   • __studioAudioSetVolume writes through to the gain node
//   • Panel open mounts the DOM, renders the wave canvas + transport,
//     and Esc closes it
//   • __studioPlayAnimation auto-plays every loaded audio clip
//   • __studioPauseAnimation auto-pauses every loaded clip
//   • Command palette registers every op under the "audio" category
//   • Multi-cam screenshots so the remote-desktop watcher can see it

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-audio');

test('Studio V3 — audio system + waveform timeline', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 200,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function', null, { timeout: 15000 });

  // ─── Side-effect-import the autoload so the op surface lights up
  // even when api.js orchestration hasn't been wired by another agent. ─
  await win.evaluate(async () => {
    if (typeof window.__studioAudioLoad !== 'function') {
      await import('/src/workbenches/studio/v3/audio/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioAudioLoad === 'function'
       && typeof window.__studioAudioGenerateSineWave === 'function'
       && typeof window.__studioAudioRenderWaveform === 'function'
       && typeof window.__studioAudioPanelOpen === 'function',
    null, { timeout: 15000 },
  );

  // ─── Synthesise two sine clips. ────────────────────────────────────
  const gen1 = await win.evaluate(() => window.__studioAudioGenerateSineWave(440, 1));
  expect(gen1.ok).toBe(true);
  expect(typeof gen1.uuid).toBe('string');
  expect(gen1.duration).toBeCloseTo(1, 2);
  expect(gen1.channels).toBeGreaterThanOrEqual(1);
  expect(gen1.sampleRate).toBeGreaterThan(8000);
  const uuidA = gen1.uuid;

  const gen2 = await win.evaluate(() => window.__studioAudioGenerateSineWave(880, 0.5));
  expect(gen2.ok).toBe(true);
  const uuidB = gen2.uuid;

  // ─── __studioAudioList reports both clips. ─────────────────────────
  const list1 = await win.evaluate(() => window.__studioAudioList());
  expect(list1.ok).toBe(true);
  expect(list1.count).toBeGreaterThanOrEqual(2);
  const uuids = list1.clips.map((c) => c.uuid);
  expect(uuids).toContain(uuidA);
  expect(uuids).toContain(uuidB);

  // ─── __studioAudioRenderWaveform → non-empty data URL + correct dims.
  const wf = await win.evaluate((u) => window.__studioAudioRenderWaveform(u, 320, 60), uuidA);
  expect(wf.ok).toBe(true);
  expect(wf.width).toBe(320);
  expect(wf.height).toBe(60);
  expect(wf.peak).toBeGreaterThan(0.1);   // sine tone has peak ~0.4
  expect(wf.peak).toBeLessThanOrEqual(1);
  expect(typeof wf.dataUrl).toBe('string');
  expect(wf.dataUrl.startsWith('data:image/png')).toBe(true);

  // Headless envelope helper also works.
  const env = await win.evaluate((u) => window.__studioAudioEnvelope(u, 32), uuidA);
  expect(env.ok).toBe(true);
  expect(env.mins.length).toBe(32);
  expect(env.maxs.length).toBe(32);
  // A 440Hz sine across a 1-s buffer @ 44.1kHz produces non-trivial
  // min/max spread in every column.
  let nonZeroCols = 0;
  for (let i = 0; i < 32; i++) {
    if (env.maxs[i] - env.mins[i] > 0.01) nonZeroCols += 1;
  }
  expect(nonZeroCols).toBeGreaterThan(20);

  // ─── Data-URL load path: hand-roll a tiny PCM WAV. ────────────────
  const wavLoad = await win.evaluate(async () => {
    // 0.25s of 220Hz mono sine @ 22050 Hz, 16-bit PCM.
    const sr = 22050;
    const dur = 0.25;
    const len = Math.round(sr * dur);
    const bytesPerSample = 2;
    const dataSize = len * bytesPerSample;
    const headerSize = 44;
    const total = headerSize + dataSize;
    const buf = new ArrayBuffer(total);
    const dv = new DataView(buf);
    const writeStr = (off, s) => {
      for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    dv.setUint32(4, total - 8, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    dv.setUint32(16, 16, true);          // PCM fmt chunk size
    dv.setUint16(20, 1, true);           // PCM format
    dv.setUint16(22, 1, true);           // 1 channel
    dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * bytesPerSample, true);
    dv.setUint16(32, bytesPerSample, true);
    dv.setUint16(34, 16, true);          // bits per sample
    writeStr(36, 'data');
    dv.setUint32(40, dataSize, true);
    const w = 2 * Math.PI * 220 / sr;
    for (let i = 0; i < len; i++) {
      const s = Math.sin(w * i) * 0.4;
      dv.setInt16(headerSize + i * 2, Math.max(-32768, Math.min(32767, Math.round(s * 32767))), true);
    }
    // Convert to data URL so we can stress the string-input path.
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);
    const url = 'data:audio/wav;base64,' + b64;
    return await window.__studioAudioLoad(url, { name: 'test-wav-220Hz.wav' });
  });
  expect(wavLoad.ok).toBe(true);
  expect(wavLoad.duration).toBeCloseTo(0.25, 1);
  expect(wavLoad.channels).toBe(1);
  expect(Math.round(wavLoad.sampleRate)).toBe(22050);
  const uuidC = wavLoad.uuid;

  // ─── Transport: play → wait → assert play head advanced. ──────────
  const playRes = await win.evaluate((u) => window.__studioAudioPlay(u), uuidA);
  expect(playRes.ok).toBe(true);
  expect(playRes.time).toBeCloseTo(0, 3);

  await win.waitForTimeout(250);
  const t1 = await win.evaluate((u) => window.__studioAudioGetCurrentTime(u), uuidA);
  expect(t1.ok).toBe(true);
  expect(t1.time).toBeGreaterThan(0.05);

  const isP1 = await win.evaluate((u) => window.__studioAudioIsPlaying(u), uuidA);
  expect(isP1.playing).toBe(true);

  // Pause halts the play head.
  const pauseRes = await win.evaluate((u) => window.__studioAudioPause(u), uuidA);
  expect(pauseRes.ok).toBe(true);
  expect(pauseRes.playing).toBe(false);
  await win.waitForTimeout(150);
  const t2 = await win.evaluate((u) => window.__studioAudioGetCurrentTime(u), uuidA);
  // Should be roughly equal to pauseRes.time (allow ±20 ms slack for
  // ctx scheduling jitter — paused play head shouldn't drift).
  expect(Math.abs(t2.time - pauseRes.time)).toBeLessThan(0.05);

  // Stop resets the play head.
  const stopRes = await win.evaluate((u) => window.__studioAudioStop(u), uuidA);
  expect(stopRes.ok).toBe(true);
  expect(stopRes.time).toBe(0);

  // ─── Volume control ───────────────────────────────────────────────
  const vol1 = await win.evaluate((u) => window.__studioAudioSetVolume(u, 0.25), uuidA);
  expect(vol1.ok).toBe(true);
  expect(vol1.volume).toBeCloseTo(0.25, 3);
  const vol2 = await win.evaluate((u) => window.__studioAudioGetVolume(u), uuidA);
  expect(vol2.volume).toBeCloseTo(0.25, 3);

  // ─── Panel open + renders waveform + closes via Esc. ──────────────
  await win.evaluate(() => window.__studioAudioPanelOpen());
  await expect(win.locator('[data-studio-v3-audio-panel]')).toBeVisible({ timeout: 5000 });
  await expect(win.locator('[data-studio-v3-audio-header]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-audio-wave]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-audio-list]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-audio-play]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-audio-volume]')).toBeVisible();
  // Wave image should render shortly after open.
  await expect(win.locator('[data-studio-v3-audio-wave-img]')).toBeVisible({ timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '00-panel-open.png') });

  // Click the play button — picks the active (= first) clip.
  await win.locator('[data-studio-v3-audio-play]').click();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-panel-playing.png') });
  // Pause back.
  await win.locator('[data-studio-v3-audio-play]').click();

  // Esc closes the panel.
  await win.keyboard.press('Escape');
  await expect(win.locator('[data-studio-v3-audio-panel]')).toBeHidden();

  // Toggle round-trip — should mount + unmount again.
  await win.evaluate(() => window.__studioAudioPanelToggle());
  await expect(win.locator('[data-studio-v3-audio-panel]')).toBeVisible();
  await win.evaluate(() => window.__studioAudioPanelToggle());
  await expect(win.locator('[data-studio-v3-audio-panel]')).toBeHidden();

  // ─── Animation sync: __studioPlayAnimation auto-plays audio. ──────
  // The wrap installs on autoload but api.js may have wired
  // __studioPlayAnimation after us — call __studioAudioPanelOpen
  // first to force a fresh install attempt.
  await win.evaluate(() => {
    // Re-attempt sync wrap (idempotent) by re-running the installer.
    if (typeof window.__studioAudioLoad === 'function'
        && typeof window.__studioPlayAnimation === 'function'
        && !window.__studioPlayAnimation.__studioAudioWrap) {
      // Force a re-install through the autoload barrel — installer
      // is idempotent except for the sync-wrap which checks the flag.
      return import('/src/workbenches/studio/v3/audio/playback.js').then((m) => m.installAnimSync());
    }
  });
  const wrapped = await win.evaluate(() =>
    !!(window.__studioPlayAnimation && window.__studioPlayAnimation.__studioAudioWrap));
  expect(wrapped).toBe(true);

  // Trigger play through the animation system — every clip should
  // start from t=0 again.
  await win.evaluate((u) => window.__studioAudioStop(u), uuidA);
  await win.evaluate(() => {
    try { window.__studioPlayAnimation(2); } catch (_) {}
  });
  await win.waitForTimeout(220);
  const tAfterAnim = await win.evaluate((u) => window.__studioAudioGetCurrentTime(u), uuidA);
  expect(tAfterAnim.time).toBeGreaterThan(0.05);

  // ...and __studioPauseAnimation halts them.
  await win.evaluate(() => { try { window.__studioPauseAnimation(); } catch (_) {} });
  await win.waitForTimeout(120);
  const tPaused = await win.evaluate((u) => window.__studioAudioGetCurrentTime(u), uuidA);
  const playingAfter = await win.evaluate((u) => window.__studioAudioIsPlaying(u), uuidA);
  expect(playingAfter.playing).toBe(false);
  // Position shouldn't have advanced (much) after pause.
  await win.waitForTimeout(120);
  const tPausedLater = await win.evaluate((u) => window.__studioAudioGetCurrentTime(u), uuidA);
  expect(Math.abs(tPausedLater.time - tPaused.time)).toBeLessThan(0.05);

  // ─── Delete one clip + clear the rest. ───────────────────────────
  const delRes = await win.evaluate((u) => window.__studioAudioDelete(u), uuidB);
  expect(delRes.ok).toBe(true);
  expect(delRes.removed).toBe(true);
  const listAfterDel = await win.evaluate(() => window.__studioAudioList());
  const remainingUuids = listAfterDel.clips.map((c) => c.uuid);
  expect(remainingUuids).not.toContain(uuidB);
  expect(remainingUuids).toContain(uuidA);
  expect(remainingUuids).toContain(uuidC);

  // ─── Command palette registration: every op exists under "audio". ─
  const cmds = await win.evaluate(() => window.__studioCommandList && window.__studioCommandList('audio'));
  expect(cmds && cmds.ok).toBe(true);
  const names = cmds.commands.map((c) => c.name);
  for (const expected of [
    '__studioAudioLoad', '__studioAudioGenerateSineWave',
    '__studioAudioRenderWaveform',
    '__studioAudioPlay', '__studioAudioPause', '__studioAudioStop',
    '__studioAudioSetVolume', '__studioAudioGetCurrentTime',
    '__studioAudioList', '__studioAudioDelete',
    '__studioAudioPanelOpen', '__studioAudioPanelClose', '__studioAudioPanelToggle',
  ]) {
    expect(names).toContain(expected);
  }

  // ─── Final multi-cam screenshots to make the slice watchable. ─────
  await win.evaluate(() => window.__studioAudioPanelOpen());
  // Spawn a cube so the viewport isn't completely blank under the panel.
  try {
    const btn = win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]');
    if (await btn.count()) await btn.click();
  } catch (_) {}
  await win.waitForTimeout(300);
  for (const view of ['front', 'top', 'right', 'iso', 'close']) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 0.3, 0.5);
      else if (v === 'top') c.position.set(0, 0.7, 0.001);
      else if (v === 'right') c.position.set(0.5, 0.3, 0);
      else if (v === 'iso') c.position.set(0.4, 0.35, 0.4);
      else if (v === 'close') c.position.set(0.15, 0.2, 0.2);
      c.lookAt(0, 0.1, 0);
    }, view);
    await win.waitForTimeout(140);
    await win.screenshot({ path: path.join(OUT, `02-cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  audio: %d clips, peak %f, midT %f',
    listAfterDel.count, wf.peak, t1.time);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
