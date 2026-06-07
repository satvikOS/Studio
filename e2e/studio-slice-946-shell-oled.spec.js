import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 946 — Studio shell + monochrome OLED redesign.
//
// Headed Mac-Electron multi-cam capture per [[feedback-headed-tests]] +
// [[feedback-forge-multicam-e2e]]. Verifies:
//   1. V3 shell mounts (V2 monolith permanently unmounted)
//   2. Canonical 9-discipline rail (no more 15-tab chaos)
//   3. Each discipline reveals a per-discipline toolbar
//   4. Monochrome state language — no chromatic accent in primary chrome
//   5. ≥5 named camera angles captured for remote-desktop verification

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-946-shell-oled');

const CANONICAL_DISCIPLINES = [
  'model', 'sculpt', 'uv', 'shade', 'animate',
  'render', 'compose', 'sim', 'layout',
];

test('Studio slice 946 — Forge-mirror shell + OLED monochrome theme', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  // Pass --dev so Electron loads from the Vite server (localhost:3000)
  // and picks up live edits. The default load path is the prebuilt
  // frontend/dist/ bundle, which would be stale during the redesign.
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 280,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  // Slice 946 — V3 is the only path; the opt-out localStorage key is
  // ignored by the new gate. We still clear any stale prefs from earlier
  // runs so this spec is deterministic.
  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    window.localStorage.removeItem('studio.v3.accent');
    window.localStorage.setItem('studioV3Theme', 'dark');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');

  // 1. V3 shell mounted.
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await expect(win.locator('[data-studio-v3-topbar]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-wb-rail]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-toolbar]')).toBeVisible();
  await win.waitForTimeout(400);

  // 2. Canonical 9 disciplines — every old extra tab must be gone.
  const railIds = await win.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('[data-studio-v3-wb]'));
    return btns.map((b) => b.getAttribute('data-studio-v3-wb'));
  });
  expect(railIds).toEqual(CANONICAL_DISCIPLINES);
  // Folded disciplines must NOT appear as their own tabs.
  for (const folded of ['paint', 'rig', 'fx', 'world', 'nurbs', 'phys', 'audio', 'xr', 'script', 'archie']) {
    expect(railIds).not.toContain(folded);
  }

  // CAM 1 — default view (Model discipline, dark theme).
  await win.screenshot({ path: path.join(OUT, '01-default-dark-model.png') });

  // 3. Click through each discipline tab — verifying toolbar swaps.
  const camPlan = [
    { d: 'sculpt',  name: '02-sculpt-toolbar' },
    { d: 'uv',      name: '03-uv-toolbar' },
    { d: 'shade',   name: '04-shade-toolbar' },
    { d: 'animate', name: '05-animate-toolbar' },
    { d: 'render',  name: '06-render-toolbar' },
    { d: 'compose', name: '07-compose-toolbar' },
    { d: 'sim',     name: '08-sim-toolbar' },
    { d: 'layout',  name: '09-layout-toolbar' },
  ];
  for (const cam of camPlan) {
    await win.locator(`[data-studio-v3-wb="${cam.d}"]`).click();
    await win.waitForTimeout(220);
    // Each discipline must render at least one toolbar group.
    const groupCount = await win.locator('[data-studio-v3-toolbar-group]').count();
    expect(groupCount).toBeGreaterThan(0);
    await win.screenshot({ path: path.join(OUT, `${cam.name}.png`) });
  }

  // Return to Model for the remaining caps.
  await win.locator('[data-studio-v3-wb="model"]').click();
  await win.waitForTimeout(180);

  // 4. Monochrome verification — sample the WB rail tab's computed
  //    background for the active discipline; must be a true greyscale
  //    pixel (R === G === B) per the Q3 lock-in.
  const tabBg = await win.evaluate(() => {
    const t = document.querySelector('[data-studio-v3-wb="model"]');
    if (!t) return null;
    return window.getComputedStyle(t).backgroundColor;
  });
  expect(tabBg).toBeTruthy();
  const rgb = (tabBg || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  expect(rgb).toBeTruthy();
  if (rgb) {
    const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    // True monochrome: R === G === B. Allow ±2 for sub-pixel rounding.
    expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
  }

  // CAM 10 — Shift+A QuickAddMenu open over viewport.
  await win.locator('[data-studio-v3-viewport]').first().hover();
  await win.keyboard.press('Shift+A');
  await win.waitForTimeout(180);
  const quickAdd = win.locator('[data-studio-v3-quick-add]');
  if (await quickAdd.count() > 0) {
    await win.screenshot({ path: path.join(OUT, '10-quick-add-menu.png') });
    await win.keyboard.press('Escape');
    await win.waitForTimeout(140);
  }

  // CAM 11 — light theme.
  await win.locator('[data-studio-v3-theme-toggle]').click();
  await win.waitForTimeout(220);
  await win.screenshot({ path: path.join(OUT, '11-light-theme.png') });
  // Toggle back so the next run starts dark.
  await win.locator('[data-studio-v3-theme-toggle]').click();
  await win.waitForTimeout(220);

  // CAM 12 — full app, dark, Model. Final reference for visual diff.
  await win.screenshot({ path: path.join(OUT, '12-final-dark-model.png'), fullPage: false });

  // Avoid the unsaved-prompt blocker on app close.
  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(140);
  await app.close();
});
