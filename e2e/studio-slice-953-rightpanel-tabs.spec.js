import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

// Slice 953 — §6 UI surfaces: Render Queue tab (over the long-shipped
// queue back-end) + Reference Library tab (PureRef-style, local-only).
// Pure UI spec — no model required.

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('Studio slice 953 — render queue + reference library tabs', async () => {
  test.setTimeout(180000);
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: 100,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate((png) => {
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
    window.localStorage.setItem('studio.v3.reference-library', JSON.stringify([
      { id: 'ref-seed', name: 'moodboard.png', dataUrl: png, caption: null },
    ]));
  }, TINY_PNG);
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(600);

  // ── Render tab
  await win.locator('[data-studio-v3-right-tab="render"]').click();
  await expect(win.locator('[data-studio-v3-render-queue]')).toBeVisible({ timeout: 4000 });
  await win.locator('[data-studio-v3-rq-add]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-v3-rq-job]')).toHaveCount(1);
  // Run executes + restores camera; queue drains.
  const camBefore = await win.evaluate(() => window.__archdiscViewport.camera.position.toArray());
  await win.locator('[data-studio-v3-rq-run]').click();
  await win.waitForTimeout(1200);
  await expect(win.locator('[data-studio-v3-rq-job]')).toHaveCount(0);
  const camAfter = await win.evaluate(() => window.__archdiscViewport.camera.position.toArray());
  expect(camAfter.map((v) => +v.toFixed(2))).toEqual(camBefore.map((v) => +v.toFixed(2)));
  // Re-add + clear.
  await win.locator('[data-studio-v3-rq-add]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-v3-rq-clear]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-v3-rq-job]')).toHaveCount(0);

  // ── Refs tab
  await win.locator('[data-studio-v3-right-tab="refs"]').click();
  await expect(win.locator('[data-studio-v3-refs]')).toBeVisible({ timeout: 4000 });
  await expect(win.locator('[data-studio-v3-ref="moodboard.png"]')).toBeVisible();
  // describe degrades honestly with the vision server down
  await win.locator('[data-studio-v3-ref-describe]').click();
  await win.waitForTimeout(800);
  const cap = await win.locator('[data-studio-v3-ref="moodboard.png"]').textContent();
  expect(cap).toContain('vision server offline');
  // "use" prepends VISIBLY into the cmdbar — never hidden injection
  await win.locator('[data-studio-v3-ref-use]').click();
  const val = await win.locator('[data-studio-v3-cmdbar-input]').inputValue();
  expect(val).toContain('Reference "moodboard.png"');

  await win.screenshot({ path: path.join(__dirname, 'screenshots', 'slice-953-tabs.png') });
  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
