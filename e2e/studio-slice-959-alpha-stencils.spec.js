import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

// Slice 959 — parity ledger #7: custom alpha-image stencils for the
// sculpt stamp brush (ZBrush parity). A half-white/half-black stencil
// must modulate brush weight asymmetrically — displacement on the
// bright half, none on the dark half. Built-ins stay intact; uniform
// images are rejected loudly.

test('Studio slice 959 — custom alpha-image stencils', async () => {
  test.setTimeout(120000);
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: 100,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => {
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioSculptAlphaLoadImage === 'function',
    null, { timeout: 10000 });

  const result = await win.evaluate(async () => {
    // Build a half-white / half-black stencil as a data URL.
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 32, 64);
    ctx.fillStyle = '#fff'; ctx.fillRect(32, 0, 32, 64);
    const url = cv.toDataURL('image/png');

    const load = await window.__studioSculptAlphaLoadImage('half-split', url);
    const list = window.__studioSculptAlphaList();

    // Sample both halves through the live sampler.
    const dark = window.__studioSculptAlphaSample(0.2, 0.5).weight;
    const bright = window.__studioSculptAlphaSample(0.8, 0.5).weight;

    // Uniform stencil must be rejected.
    const ucv = document.createElement('canvas');
    ucv.width = 8; ucv.height = 8;
    ucv.getContext('2d').fillStyle = '#888';
    ucv.getContext('2d').fillRect(0, 0, 8, 8);
    let uniformError = null;
    try {
      const r = await window.__studioSculptAlphaLoadImage('uniform', ucv.toDataURL());
      uniformError = r.ok ? null : r.error;
    } catch (e) { uniformError = e.message; }

    // Built-in protection.
    const delBuiltin = window.__studioSculptAlphaDeleteCustom('circle');
    const delCustom = window.__studioSculptAlphaDeleteCustom('half-split');

    return { load, list, dark, bright, uniformError, delBuiltin, delCustom };
  });

  expect(result.load.ok).toBe(true);
  expect(result.load.resolution).toBe(128);
  expect(result.list.alphas).toContain('half-split');
  expect(result.list.custom).toContain('half-split');
  expect(result.list.count).toBe(9); // 8 built-ins + the custom one

  expect(result.dark).toBeLessThan(0.05);
  expect(result.bright).toBeGreaterThan(0.9);

  expect(result.uniformError).toContain('uniform');
  expect(result.delBuiltin.ok).toBe(false);
  expect(result.delCustom.ok).toBe(true);

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
