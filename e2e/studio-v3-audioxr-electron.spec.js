import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-audioxr');

test('Studio V3 — spatial audio + WebXR family (slice 411)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioAddAudioSource === 'function', null, { timeout: 15000 });

  // ─── Audio ─────────────────────────────────────────────────────────────
  let r = await win.evaluate(() => window.__studioAddAudioSource({ position: [0.05, 0, 0], freq: 440 }));
  expect(r.ok).toBe(true);
  expect(r.count).toBeGreaterThanOrEqual(1);

  r = await win.evaluate(() => window.__studioAddAudioSource({ position: [-0.05, 0, 0], freq: 660 }));
  expect(r.count).toBe(2);

  r = await win.evaluate(() => window.__studioSetListener([0.02, 0.01, 0.03]));
  expect(r.ok).toBe(true);

  r = await win.evaluate(() => window.__studioAudioState());
  expect(r.ok).toBe(true);

  // ─── Scene-side: 2 audio gizmos exist as Object3Ds with archdiscAudioGizmo. ──
  const gizCount = await win.evaluate(() => {
    let n = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscAudioGizmo) n++; });
    return n;
  });
  expect(gizCount).toBe(2);

  // ─── XR ─────────────────────────────────────────────────────────────────
  // In Electron's chromium without WebXR runtime, hasXR is false. The op
  // still returns ok shape.
  const sup = await win.evaluate(() => window.__studioXRSupport('immersive-vr'));
  expect(sup.ok).toBe(true);
  expect(typeof sup.hasXR).toBe('boolean');

  const ent = await win.evaluate(() => window.__studioEnterXR('immersive-ar'));
  expect(typeof ent.entered).toBe('boolean');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 411: 2 audio sources + listener + XR support+enter probed');

  await app.close();
});
