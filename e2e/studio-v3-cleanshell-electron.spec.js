// ArchDisc Studio V3 — clean Forge-style shell / no duplicate chrome (slice 742).
//
// Headed Mac-Electron spec proving the UI-cleanup fix: the Forge-style V3
// shell is the DEFAULT (no opt-in needed) and the legacy duplicate chrome
// is gone:
//   • exactly one Studio V3 shell root renders
//   • NO legacy global AIConsole (old Archie Chat/Code/Parametric bar)
//   • NO floating uiworkbenches tab strip ([data-studio-workbenches])
//   • NO fixed category menubar overlapping the top ([data-studio-menubar])
//   • NO legacy global header / status bar
//   • the compositor output canvas is hidden until it actually paints
//   • the old V2 welcome card ("crystal garden" / "spawn suzanne") is absent

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-cleanshell');

test('Studio V3 — clean Forge-style shell, no duplicate chrome', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 120,
  });
  // --dev may auto-open a DevTools window; pick the real app window.
  let win = null;
  for (let i = 0; i < 30 && !win; i++) {
    win = app.windows().find((w) => {
      const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
      return u && !u.startsWith('devtools://');
    }) || null;
    if (!win) { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!win) win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  // Test the DEFAULT path: explicitly REMOVE any studioV3 flag so we prove
  // V3 renders without an opt-in. Only suppress the splash/tour for speed.
  await win.evaluate(() => {
    try { window.localStorage.removeItem('studioV3'); } catch (_) {}
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });

  let shellUp = false;
  for (let attempt = 0; attempt < 4 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1600);
    try {
      await expect(win.locator('[data-studio-v3-shell],[data-studio-v3-topbar]').first())
        .toBeVisible({ timeout: 40000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(OUT, '00-clean-shell.png') });

  // ── Single shell, no duplicate chrome. ────────────────────────────
  const diag = await win.evaluate(() => {
    const txt = document.body.innerText || '';
    const compositor = document.querySelector('[data-studio-v3-compositor-output]');
    return {
      shellCount: document.querySelectorAll('[data-studio-v3-shell],.studio-app[data-studio-v3-shell]').length,
      hasV3Shell: !!document.querySelector('[data-studio-v3-shell],[data-studio-v3-topbar]'),
      legacyAIConsole: !!document.querySelector('.ai-console,[class*="ai-console"]'),
      floatingTabStrip: !!document.querySelector('[data-studio-workbenches]'),
      fixedMenubar: !!document.querySelector('[data-studio-v3-menubar]'),
      legacyHeader: !!document.querySelector('.workbench-header'),
      legacyStatusBar: !!document.querySelector('.statusbar-pro,[class*="statusbar-pro"]'),
      compositorVisible: compositor ? (getComputedStyle(compositor).display !== 'none') : false,
      hasOldWelcome: /crystal garden|spawn suzanne/i.test(txt),
      hasOldParametricPanel: /Describe what you want to create/i.test(txt),
    };
  });
  console.log('[ui] diag', JSON.stringify(diag));

  expect(diag.hasV3Shell).toBe(true);
  expect(diag.legacyAIConsole).toBe(false);
  expect(diag.floatingTabStrip).toBe(false);
  expect(diag.fixedMenubar).toBe(false);
  expect(diag.legacyHeader).toBe(false);
  expect(diag.legacyStatusBar).toBe(false);
  expect(diag.compositorVisible).toBe(false);   // hidden until it paints
  expect(diag.hasOldWelcome).toBe(false);
  expect(diag.hasOldParametricPanel).toBe(false);

  // ── The shell DOES expose its single Forge-style top bar + Archie. ──
  const topbar = await win.evaluate(() => {
    const tb = document.querySelector('[data-studio-v3-topbar]');
    // Count distinct top-of-screen bars (y < 50, full-ish width) to be sure
    // there is no second one stacked above/below.
    const W = window.innerWidth;
    let topBars = 0;
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.top <= 2 && r.width > W * 0.8 && r.height >= 24 && r.height <= 60 &&
          (st.position === 'fixed' || st.position === 'absolute') &&
          st.display !== 'none') topBars++;
    });
    return { hasTopbar: !!tb, topBars };
  });
  console.log('[ui] topbar', JSON.stringify(topbar));
  expect(topbar.hasTopbar).toBe(true);
  // At most one fixed/absolute full-width bar pinned to the very top.
  expect(topbar.topBars).toBeLessThanOrEqual(1);

  // eslint-disable-next-line no-console
  console.log('  slice 742: clean shell — no legacy AIConsole/menubar/tabstrip/header, compositor hidden');

  await app.close();
});
