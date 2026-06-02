import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-lighting-section');

test('Studio V3 — N-panel Lighting sliders drive ambient + key (slice 510)', async () => {
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
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(500);

  await expect(win.locator('[data-studio-v3-lighting-section]')).toBeVisible();

  // Op surface present.
  expect(await win.evaluate(() => typeof window.__studioSetAmbientIntensity === 'function')).toBe(true);
  expect(await win.evaluate(() => typeof window.__studioSetKeyIntensity === 'function')).toBe(true);

  const ambBefore = await win.evaluate(() => window.__studioGetAmbientIntensity());

  // Drive the ambient slider to 1.6.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-light-ambient]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '1.6');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.waitForTimeout(200);
  const ambAfter = await win.evaluate(() => window.__studioGetAmbientIntensity());
  expect(ambAfter).toBeCloseTo(1.6, 1);
  expect(ambAfter).not.toBe(ambBefore);

  // Key slider to 3.5.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-light-key]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '3.5');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.waitForTimeout(200);
  const keyAfter = await win.evaluate(() => window.__studioGetKeyIntensity());
  expect(keyAfter).toBeCloseTo(3.5, 1);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 510: ambient', ambBefore, '→', ambAfter, '· key →', keyAfter);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
