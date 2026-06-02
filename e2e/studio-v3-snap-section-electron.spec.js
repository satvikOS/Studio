import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-snap-section');

test('Studio V3 — N-panel Snap step inputs drive snap ops (slice 499)', async () => {
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
  await win.waitForTimeout(400);

  await expect(win.locator('[data-studio-v3-snap-section]')).toBeVisible();

  // Programmatically set translate-snap input to 25 (mm).
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-snap-step="translate"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '25');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.waitForTimeout(200);
  const snap = await win.evaluate(() => window.__studioGetSnap());
  expect(snap.t).toBeCloseTo(0.025, 4);

  // Enable toggle inside the panel.
  await win.locator('[data-studio-v3-snap-enable]').click();
  await win.waitForTimeout(200);
  const snap2 = await win.evaluate(() => window.__studioGetSnap());
  expect(snap2.on).toBe(true);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 499: snap section translate', snap.t * 1000, 'mm · on', snap2.on);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
