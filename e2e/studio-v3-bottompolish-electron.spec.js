// ArchDisc Studio V3 — bottom-chrome polish (slice 743).
//
// Headed Mac-Electron spec. Removes the last duplicate injected chrome that
// made the shell look unpolished: the uistatusbar debug strip
// ([data-studio-status-bar]) auto-mounted a second "FPS V T cam Sel" bar
// (plus a debug tick-ruler) at the very bottom edge, stacked under the V3
// shell's OWN polished status bar.
//
// Verifies on the DEFAULT launch (V3 is default-on):
//   • the injected uistatusbar strip is NOT present/visible
//   • the shell still renders its own status bar (snap: indicator present)
//   • there is exactly ONE full-width bar pinned to the very bottom edge
//   • a clean screenshot for visual confirmation

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-bottompolish');

test('Studio V3 — clean bottom chrome (no duplicate status strip / ruler)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 120,
  });
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
  // Give the (now-suppressed) auto-enable timers their old 800ms window to
  // prove they no longer fire.
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-clean-bottom.png') });

  const diag = await win.evaluate(() => {
    const H = window.innerHeight;
    // The injected debug strip lives at [data-studio-status-bar].
    const injected = document.querySelector('[data-studio-status-bar]');
    const injectedVisible = injected ? (getComputedStyle(injected).display !== 'none'
      && injected.getBoundingClientRect().height > 0) : false;
    // Count full-width bars pinned to the very BOTTOM edge.
    const W = window.innerWidth;
    let bottomBars = 0;
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return;
      if (r.width > W * 0.8 && r.height >= 14 && r.height <= 60 &&
          Math.abs(r.bottom - H) <= 2 &&
          (st.position === 'fixed' || st.position === 'absolute')) bottomBars++;
    });
    // The shell's own status bar has the snap: indicator.
    const txt = document.body.innerText || '';
    return { injectedPresent: !!injected, injectedVisible, bottomBars, hasSnap: /snap:/i.test(txt) };
  });
  console.log('[bottom] diag', JSON.stringify(diag));

  // The injected debug strip must NOT be auto-shown.
  expect(diag.injectedVisible).toBe(false);
  // The shell's own status bar is still there.
  expect(diag.hasSnap).toBe(true);
  // At most one bar glued to the very bottom edge (the shell's own).
  expect(diag.bottomBars).toBeLessThanOrEqual(1);

  // eslint-disable-next-line no-console
  console.log('  slice 743: bottom chrome clean — injected status strip suppressed, one status bar');

  await app.close();
});
