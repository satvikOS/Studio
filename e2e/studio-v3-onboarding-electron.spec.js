import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-onboarding');

test('Studio V3 — first-launch onboarding tour walks 4 steps (slice 494)', async () => {
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
    window.localStorage.removeItem('studio.v3.tour-seen');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Step 1 visible.
  const tour = win.locator('[data-studio-v3-tour]');
  await expect(tour).toBeVisible();
  await expect(tour).toHaveAttribute('data-studio-v3-tour-step', '0');

  await win.screenshot({ path: path.join(OUT, '00-step1.png') });

  // Click Next → step 2.
  await win.locator('[data-studio-v3-tour-next]').click();
  await expect(tour).toHaveAttribute('data-studio-v3-tour-step', '1');

  // Step 2 → 3.
  await win.locator('[data-studio-v3-tour-next]').click();
  await expect(tour).toHaveAttribute('data-studio-v3-tour-step', '2');

  // Step 3 → 4.
  await win.locator('[data-studio-v3-tour-next]').click();
  await expect(tour).toHaveAttribute('data-studio-v3-tour-step', '3');

  await win.screenshot({ path: path.join(OUT, '01-step4.png') });

  // Step 4 → done (tour unmounts).
  await win.locator('[data-studio-v3-tour-next]').click();
  await expect(tour).toHaveCount(0);

  // localStorage marker set.
  const seen = await win.evaluate(() => window.localStorage.getItem('studio.v3.tour-seen'));
  expect(seen).toBe('1');

  // Reload doesn't re-show it.
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-v3-tour]')).toHaveCount(0);

  // eslint-disable-next-line no-console
  console.log('  slice 494: onboarding tour 4 steps + persistence verified');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
