import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 947 — Footer Archie console + floating chat overlay.
//
// Verifies the new conversation model:
//   1. Overlay is HIDDEN by default — only the cmdbar shows at the foot
//   2. Clicking / focusing the cmdbar input opens the floating overlay
//   3. Typing + Enter in the cmdbar pushes a user+tool message pair
//      and the overlay scrolls to show the latest
//   4. Esc closes the overlay; the cmdbar persists with a count chip
//   5. Clicking the chip reopens the overlay
//   6. Expand toggle resizes the overlay (40 % wider, ~80 vh)
//   7. Clear empties the thread; chip disappears

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-947-archie-overlay');

test('Studio slice 947 — Archie footer console + floating chat overlay', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 280,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.accent');
    window.localStorage.setItem('studioV3Theme', 'dark');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');

  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await expect(win.locator('[data-studio-v3-cmdbar]')).toBeVisible();
  await win.waitForTimeout(400);

  // CAM 1 — closed default. Overlay must NOT be in the DOM, chip absent.
  expect(await win.locator('[data-studio-v3-archie-overlay]').count()).toBe(0);
  expect(await win.locator('[data-studio-v3-cmdbar-chip]').count()).toBe(0);
  await win.screenshot({ path: path.join(OUT, '01-closed-default.png') });

  // 2. Click cmdbar input → overlay opens.
  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.waitForTimeout(220);
  await expect(win.locator('[data-studio-v3-archie-overlay]')).toBeVisible();
  // Empty-state copy renders.
  await expect(win.locator('[data-studio-v3-archie-empty]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '02-overlay-opened-focus.png') });

  // 3. Type a direct-call API and hit Enter — the cmdbar onSubmit pushes
  //    a user message and a tool result into the thread.
  await win.locator('[data-studio-v3-cmdbar-input]').fill('studioListSceneStats');
  await win.waitForTimeout(140);
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');
  await win.waitForTimeout(280);

  const msgs = await win.locator('[data-studio-v3-archie-msg]').count();
  expect(msgs).toBeGreaterThanOrEqual(2);
  // Header count chip reflects the thread length.
  const count = await win.locator('[data-studio-v3-archie-count]').first().textContent();
  expect(Number(count)).toBeGreaterThanOrEqual(2);
  await win.screenshot({ path: path.join(OUT, '03-overlay-with-messages.png') });

  // 4. Expand toggle — overlay widens.
  await win.locator('[data-studio-v3-archie-expand]').click();
  await win.waitForTimeout(220);
  const expanded = await win.locator('[data-studio-v3-archie-overlay]').getAttribute('data-archie-expanded');
  expect(expanded).toBe('true');
  await win.screenshot({ path: path.join(OUT, '04-overlay-expanded.png') });
  // Collapse back.
  await win.locator('[data-studio-v3-archie-expand]').click();
  await win.waitForTimeout(220);

  // 5. Esc closes; cmdbar chip should appear (thread > 0).
  await win.locator('[data-studio-v3-cmdbar-input]').focus();
  await win.keyboard.press('Escape');
  await win.waitForTimeout(220);
  expect(await win.locator('[data-studio-v3-archie-overlay]').count()).toBe(0);
  await expect(win.locator('[data-studio-v3-cmdbar-chip]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '05-overlay-closed-chip-shows.png') });

  // 6. Chip reopens.
  await win.locator('[data-studio-v3-cmdbar-chip]').click();
  await win.waitForTimeout(220);
  await expect(win.locator('[data-studio-v3-archie-overlay]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '06-overlay-reopened-via-chip.png') });

  // 7. Clear empties the thread; the count chip goes away.
  await win.locator('[data-studio-v3-archie-clear]').click();
  await win.waitForTimeout(220);
  await expect(win.locator('[data-studio-v3-archie-empty]')).toBeVisible();
  // Close to verify chip absent after clear.
  await win.locator('[data-studio-v3-archie-close]').click();
  await win.waitForTimeout(220);
  expect(await win.locator('[data-studio-v3-cmdbar-chip]').count()).toBe(0);
  await win.screenshot({ path: path.join(OUT, '07-cleared-closed.png') });

  // CAM 8 — Cmd+K opens overlay AND focuses input.
  await win.keyboard.press('Meta+k');
  await win.waitForTimeout(220);
  await expect(win.locator('[data-studio-v3-archie-overlay]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '08-cmd-k-opened.png') });

  // 9. Verify the overlay border is monochrome (R === G === B ±2).
  const borderColor = await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-archie-overlay]');
    if (!el) return null;
    return window.getComputedStyle(el).borderTopColor;
  });
  expect(borderColor).toBeTruthy();
  const rgb = (borderColor || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  expect(rgb).toBeTruthy();
  if (rgb) {
    const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
  }

  // Final teardown — close cleanly.
  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(140);
  await app.close();
});
