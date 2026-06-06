// ArchDisc Studio V3 — HDRI environment library (slice 770).
//
// Headed Mac-Electron spec. Verifies the procedural HDR library:
//   • boot the V3 shell, install the hdrlib autoload
//   • __studioHDRListEnvs() returns ≥20 named envs
//   • __studioHDRApply({envName:'outdoor_sunset'}) → ok + applied
//   • scene.environment is now a non-null THREE.Texture
//   • __studioHDRSetIntensity({intensity:1.5}) → ok
//   • __studioHDRSetRotation({angleDeg:90}) → ok
//   • 5 cam angles for remote-desktop verification
//
// e2e DOES NOT run during this slice (per the slice brief — the harness
// runs builds, not playwright). This file just has to compile cleanly
// when the autoload + the ops are wired correctly.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-hdrlib');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — HDRI environment library (slice 770)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });
  // --dev may auto-open a DevTools window; pick the real app window.
  let win = null;
  for (let i = 0; i < 30 && !win; i++) {
    win = app.windows().find((w) => {
      const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
      return u && !u.startsWith('devtools://');
    }) || null;
    if (!win) { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!win) win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  let shellUp = false;
  for (let attempt = 0; attempt < 4 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1500);
    try {
      await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 40000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 30000 });

  // ── Ensure the hdrlib module is installed. ─────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioHDRListEnvs !== 'function') {
      await import('/src/workbenches/studio/v3/hdrlib/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioHDRListEnvs === 'function'
       && typeof window.__studioHDRApply === 'function'
       && typeof window.__studioHDRSetIntensity === 'function'
       && typeof window.__studioHDRSetRotation === 'function'
       && typeof window.__studioHDRLoadCustom === 'function',
    null, { timeout: 20000 }
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) List envs — must be ≥20 and include the four canonical groups. ─
  const list = await win.evaluate(() => window.__studioHDRListEnvs());
  console.log('[hdrlib] list', JSON.stringify(list));
  expect(list.ok).toBe(true);
  expect(Array.isArray(list.envs)).toBe(true);
  expect(list.envs.length).toBeGreaterThanOrEqual(20);
  expect(list.envs).toContain('studio_white');
  expect(list.envs).toContain('outdoor_sunset');
  expect(list.envs).toContain('interior_room');
  expect(list.envs).toContain('dramatic_red');
  expect(list.envs).toContain('colorgrade_cinema');

  // ── 2) Apply outdoor_sunset. scene.environment must be set. ─────────
  const applied = await win.evaluate(() => {
    return window.__studioHDRApply({ envName: 'outdoor_sunset' });
  });
  console.log('[hdrlib] apply', JSON.stringify(applied));
  expect(applied.ok).toBe(true);
  expect(applied.applied).toBe('outdoor_sunset');

  const sceneInspect = await win.evaluate(() => {
    const s = window.__archdiscScene
      || (window.__archdiscViewport && window.__archdiscViewport.scene);
    return {
      hasEnv: !!(s && s.environment),
      hasBg: !!(s && s.background),
      envIsTexture: !!(s && s.environment && s.environment.isTexture),
    };
  });
  console.log('[hdrlib] sceneInspect', JSON.stringify(sceneInspect));
  expect(sceneInspect.hasEnv).toBe(true);
  expect(sceneInspect.envIsTexture).toBe(true);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-sunset.png') });

  // ── 3) Intensity + rotation ops. ───────────────────────────────────
  const intR = await win.evaluate(() => {
    return window.__studioHDRSetIntensity({ intensity: 1.5 });
  });
  expect(intR.ok).toBe(true);
  const rotR = await win.evaluate(() => {
    return window.__studioHDRSetRotation({ angleDeg: 90 });
  });
  expect(rotR.ok).toBe(true);

  // ── 4) Bad envName must error cleanly (no throw). ─────────────────
  const bad = await win.evaluate(() => {
    return window.__studioHDRApply({ envName: 'does_not_exist' });
  });
  expect(bad.ok).toBe(false);
  expect(typeof bad.error).toBe('string');

  // ── 5) Camera sweep. ──────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport;
      const c = vp && vp.camera;
      if (c) {
        if (v === 'front') c.position.set(0, 0, 4);
        else if (v === 'top') c.position.set(0, 4, 0.001);
        else if (v === 'right') c.position.set(4, 0, 0);
        else if (v === 'iso') c.position.set(3, 3, 3);
        else if (v === 'close') c.position.set(1.5, 1.5, 1.5);
        c.lookAt(0, 0, 0);
      } else if (typeof window.__studioSetView === 'function') {
        window.__studioSetView(v);
      } else if (typeof window.__archdiscSetView === 'function') {
        window.__archdiscSetView(v);
      }
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 770: hdrlib envs=%d applied=%s rotated=%s',
    list.envs.length, applied.applied, rotR.ok);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
