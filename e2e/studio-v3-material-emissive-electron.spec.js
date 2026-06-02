import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-material-emissive');

test('Studio V3 — material emissive color + glow inputs (slice 530)', async () => {
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
  await win.waitForTimeout(400);

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(600);

  await expect(win.locator('[data-studio-v3-material-emissive]')).toBeVisible();

  // Set emissive color.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-material-emissive]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '#ff00aa');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.waitForTimeout(150);

  const hex = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return mat.emissive ? '#' + mat.emissive.getHexString() : null;
  });
  expect(hex && hex.toLowerCase()).toBe('#ff00aa');

  // Glow slider.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-material-emissive-intensity]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '2.4');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await win.waitForTimeout(150);

  const glow = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return mat.emissiveIntensity;
  });
  expect(glow).toBeCloseTo(2.4);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 530: emissive', hex, '· glow', glow);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
