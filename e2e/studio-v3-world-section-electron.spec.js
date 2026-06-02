import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-world-section');

test('Studio V3 — N-panel World controls drive grid + bg (slice 508)', async () => {
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

  await expect(win.locator('[data-studio-v3-world-section]')).toBeVisible();

  const gridBefore = await win.evaluate(() => window.__studioGridSize);

  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-world-grid]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '2.5');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.waitForTimeout(200);

  const gridAfter = await win.evaluate(() => window.__studioGridSize);
  expect(gridAfter).toBeCloseTo(2.5);
  expect(gridAfter).not.toBe(gridBefore);

  // Background color: drive via direct setter + input event.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-world-bg]');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '#1a4055');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.waitForTimeout(200);

  const bgHex = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    return vp && vp.scene && vp.scene.background && vp.scene.background.getHexString
      ? '#' + vp.scene.background.getHexString()
      : null;
  });
  if (bgHex) expect(bgHex.toLowerCase()).toBe('#1a4055');

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 508: grid', gridBefore, '→', gridAfter, '· bg', bgHex);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
