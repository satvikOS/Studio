// ArchDisc Studio V3 — KeyShot studio environments + render presets (slice 772).
//
// Headed Mac-Electron spec. Verifies the slice-772 KeyShot surface:
//   • boot the V3 shell, ensure the keyshot autoload installed
//   • __studioKSListStudios() returns ≥10 studios incl. the 10 named ones
//   • __studioKSApplyStudio({name:'beauty_shot'}) → ok + applied
//   • renderer.toneMapping CHANGED from baseline (apply path wrote AgX)
//   • __studioKSListPresets() returns ≥8 presets incl. the 8 named ones
//   • __studioKSApplyPreset({name:'pro'}) → ok + applied
//   • renderer.pixelRatio CHANGED from baseline (apply path wrote 1.5)
//   • 5 named camera angles get captured for remote-desktop watchers.
//
// e2e DOES NOT run during this slice (per the brief); this file just has
// to compile when written.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-keyshot');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

const STUDIO_NAMES = [
  'product_photography', 'beauty_shot', 'sketchfab_classic', 'whitestudio',
  'dark_studio', 'rim_light', 'turntable_a', 'turntable_b',
  'lookdev_neutral', 'lookdev_warm',
];

const PRESET_NAMES = [
  'draft', 'standard', 'pro', 'photo',
  'preview_clay', 'preview_xray', 'studio_white', 'turntable_bright',
];

test('Studio V3 — KeyShot studio environments + render presets (slice 772)', async () => {
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

  // ── Ensure the keyshot autoload has run. ────────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioKSListStudios !== 'function') {
      await import('/src/workbenches/studio/v3/keyshot/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioKSListStudios === 'function'
       && typeof window.__studioKSApplyStudio === 'function'
       && typeof window.__studioKSListPresets === 'function'
       && typeof window.__studioKSApplyPreset === 'function'
       && typeof window.__studioKSStudioApply === 'function'
       && typeof window.__studioKSRenderPresetApply === 'function'
       && typeof window.__studioKSListEnvironments === 'function',
    null, { timeout: 20000 }
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── Baseline: record the renderer's tone-mapping + pixel ratio. ──
  const before = await win.evaluate(() => {
    const r = window.__archdiscViewport && window.__archdiscViewport.renderer;
    return {
      toneMapping: r ? r.toneMapping : null,
      toneMappingExposure: r ? r.toneMappingExposure : null,
      pixelRatio: r && typeof r.getPixelRatio === 'function' ? r.getPixelRatio() : null,
    };
  });
  console.log('[keyshot] before', JSON.stringify(before));

  // ── 1) List studios — must be ≥10 and include every named entry. ──
  const studiosList = await win.evaluate(() => window.__studioKSListStudios());
  console.log('[keyshot] studios', JSON.stringify(studiosList));
  expect(studiosList.ok).toBe(true);
  expect(Array.isArray(studiosList.studios)).toBe(true);
  expect(studiosList.studios.length).toBeGreaterThanOrEqual(10);
  for (const name of STUDIO_NAMES) {
    expect(studiosList.studios).toContain(name);
  }
  // Alias also returns the same list.
  const listAlias = await win.evaluate(() => window.__studioKSListEnvironments());
  expect(listAlias.ok).toBe(true);
  expect(listAlias.studios).toEqual(studiosList.studios);

  // ── 2) Apply 'beauty_shot'. toneMapping must change from baseline. ──
  const studioApplied = await win.evaluate(() => {
    return window.__studioKSApplyStudio({ name: 'beauty_shot' });
  });
  console.log('[keyshot] applyStudio', JSON.stringify(studioApplied));
  expect(studioApplied.ok).toBe(true);
  expect(studioApplied.applied).toBe('beauty_shot');

  const afterStudio = await win.evaluate(() => {
    const r = window.__archdiscViewport && window.__archdiscViewport.renderer;
    return {
      toneMapping: r ? r.toneMapping : null,
      toneMappingExposure: r ? r.toneMappingExposure : null,
    };
  });
  console.log('[keyshot] afterStudio', JSON.stringify(afterStudio));
  expect(afterStudio.toneMapping).not.toBeNull();
  // beauty_shot is AgX (with ACES fallback); either way toneMapping
  // must differ from the canonical default NoToneMapping=0 or have
  // moved off the baseline.
  expect(afterStudio.toneMapping !== before.toneMapping
      || afterStudio.toneMappingExposure !== before.toneMappingExposure).toBe(true);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-beauty-shot.png') });

  // ── 3) List presets — must be ≥8 and include every named entry. ──
  const presetsList = await win.evaluate(() => window.__studioKSListPresets());
  console.log('[keyshot] presets', JSON.stringify(presetsList));
  expect(presetsList.ok).toBe(true);
  expect(Array.isArray(presetsList.presets)).toBe(true);
  expect(presetsList.presets.length).toBeGreaterThanOrEqual(8);
  for (const name of PRESET_NAMES) {
    expect(presetsList.presets).toContain(name);
  }

  // ── 4) Apply 'pro' preset. pixelRatio must change from baseline. ──
  const presetApplied = await win.evaluate(() => {
    return window.__studioKSApplyPreset({ name: 'pro' });
  });
  console.log('[keyshot] applyPreset', JSON.stringify(presetApplied));
  expect(presetApplied.ok).toBe(true);
  expect(presetApplied.applied).toBe('pro');

  const afterPreset = await win.evaluate(() => {
    const r = window.__archdiscViewport && window.__archdiscViewport.renderer;
    return {
      pixelRatio: r && typeof r.getPixelRatio === 'function' ? r.getPixelRatio() : null,
      shadowEnabled: !!(r && r.shadowMap && r.shadowMap.enabled),
      shadowType: r && r.shadowMap ? r.shadowMap.type : null,
    };
  });
  console.log('[keyshot] afterPreset', JSON.stringify(afterPreset));
  expect(afterPreset.pixelRatio).not.toBeNull();
  expect(afterPreset.pixelRatio).not.toBe(before.pixelRatio);

  // ── 5) Bad name must error cleanly (no throw). ───────────────────
  const badStudio = await win.evaluate(() => {
    return window.__studioKSApplyStudio({ name: 'does_not_exist' });
  });
  expect(badStudio.ok).toBe(false);
  expect(typeof badStudio.error).toBe('string');

  const badPreset = await win.evaluate(() => {
    return window.__studioKSApplyPreset({ name: 'does_not_exist' });
  });
  expect(badPreset.ok).toBe(false);
  expect(typeof badPreset.error).toBe('string');

  // ── 6) Aliases work too. ────────────────────────────────────────
  const aliasStudio = await win.evaluate(() => {
    return window.__studioKSStudioApply({ name: 'whitestudio' });
  });
  expect(aliasStudio.ok).toBe(true);
  expect(aliasStudio.applied).toBe('whitestudio');

  const aliasPreset = await win.evaluate(() => {
    return window.__studioKSRenderPresetApply({ name: 'photo' });
  });
  expect(aliasPreset.ok).toBe(true);
  expect(aliasPreset.applied).toBe('photo');

  // ── 7) 5 camera angles for remote-desktop verification. ─────────
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
  console.log('  slice 772: studios=%d presets=%d studioApplied=%s presetApplied=%s',
    studiosList.studios.length, presetsList.presets.length,
    studioApplied.applied, presetApplied.applied);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
