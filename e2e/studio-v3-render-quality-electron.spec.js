import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-render-quality');

test('Studio V3 — Settings render quality controls (slice 474)', async () => {
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
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Open Settings.
  await win.locator('[data-studio-v3-qat-btn="settings"]').click();
  await win.waitForTimeout(200);

  // At least one of the two render quality controls exists.
  const pr = win.locator('[data-studio-v3-settings-pixel-ratio]');
  const sq = win.locator('[data-studio-v3-settings-shadow-quality]');
  const prCount = await pr.count();
  const sqCount = await sq.count();
  expect(prCount + sqCount).toBeGreaterThan(0);

  // Slide pixel ratio to 1.5 — React tracks value via internal tracker,
  // so use the native setter + dispatch input to fire onChange properly.
  if (prCount) {
    await win.evaluate(() => {
      const el = document.querySelector('[data-studio-v3-settings-pixel-ratio]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '1.5');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await win.waitForTimeout(200);
    const stored = await win.evaluate(() => window.__studioPixelRatio);
    expect(stored).toBeCloseTo(1.5, 2);
  }

  // Change shadow quality to high.
  if (sqCount) {
    await sq.selectOption('high');
    await win.waitForTimeout(200);
    await expect(sq).toHaveValue('high');
  }

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 474: render quality controls present (pr+sq counts =', prCount + sqCount, ')');

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
