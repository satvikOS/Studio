import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-stage-presets');

test('Studio V3 — Stage presets one-click apply mood (slice 562)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
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
  await win.waitForTimeout(500);

  await expect(win.locator('[data-studio-v3-stage-presets]')).toBeVisible();

  // Pick sunset.
  await win.locator('[data-studio-v3-stage-preset="sunset"]').click();
  await win.waitForTimeout(250);

  const state = await win.evaluate(() => ({
    bg: window.__archdiscViewport.scene.background ? '#' + window.__archdiscViewport.scene.background.getHexString() : null,
    amb: window.__studioGetAmbientIntensity(),
    key: window.__studioGetKeyIntensity(),
  }));
  expect(state.bg && state.bg.toLowerCase()).toBe('#241010');
  expect(state.amb).toBeCloseTo(0.4, 1);
  expect(state.key).toBeCloseTo(2.6, 1);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 562: stage sunset bg', state.bg, 'amb', state.amb, 'key', state.key);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
