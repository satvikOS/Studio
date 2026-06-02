import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-sun-direction');

test('Studio V3 — sun azimuth + elevation sliders move key light (slice 540)', async () => {
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

  const before = await win.evaluate(() => {
    const k = window.__archdiscViewport.keyLight;
    return [k.position.x, k.position.y, k.position.z];
  });

  // Drive azimuth to -90.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-light-azimuth]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '-90');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.waitForTimeout(200);

  const after = await win.evaluate(() => {
    const k = window.__archdiscViewport.keyLight;
    return [k.position.x, k.position.y, k.position.z];
  });
  const moved = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
  expect(moved).toBeGreaterThan(0.5);

  // Drive elevation to 0 (horizon).
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-light-elevation]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '0');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.waitForTimeout(200);
  const horizonY = await win.evaluate(() => window.__archdiscViewport.keyLight.position.y);
  expect(Math.abs(horizonY)).toBeLessThan(0.001);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 540: sun moved', before, '→', after, '· horizon y', horizonY);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
