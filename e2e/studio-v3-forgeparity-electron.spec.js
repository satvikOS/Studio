// ArchDisc Studio V3 — Forge parity: monochrome accent + exact geometry (slice 744).
//
// Headed Mac-Electron spec. Two Forge-fidelity fixes:
//   1) MONOCHROME: the SettingsModal forced --studio-accent to a stored teal
//      (#1de9b6) on every mount, so the whole shell rendered teal even though
//      the token is monochrome. Now it inherits the monochrome token (white in
//      dark / graphite in light) unless the user explicitly picks a custom
//      accent. Forge is fully monochrome — no chromatic accent.
//   2) GEOMETRY: the shell zone heights / rail widths now match Forge exactly
//      (topbar 40 / qat 32 / toolbar 48 / statusbar 26 / cmdbar 52 / rail 72 /
//      right 340). See docs/FORGE_UI_SPEC.md.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-forgeparity');

// Forge's exact zone geometry (forge-v4/tokens.css).
const EXPECT = {
  '--studio-topbar-h': '40px',
  '--studio-qat-h': '32px',
  '--studio-toolbar-h': '48px',
  '--studio-statusbar-h': '26px',
  '--studio-cmdbar-h': '52px',
  '--studio-wb-rail-w': '72px',
  '--studio-right-w': '340px',
};

test('Studio V3 — Forge parity: monochrome accent + exact geometry', async () => {
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

  // Simulate an existing user who had the old teal accent persisted, to
  // prove the migration clears it back to monochrome.
  await win.evaluate(() => {
    try { window.localStorage.removeItem('studioV3'); } catch (_) {}
    try { window.localStorage.setItem('studio.v3.accent', '#1de9b6'); } catch (_) {}
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
  await win.waitForTimeout(1000);
  await win.screenshot({ path: path.join(OUT, '00-monochrome-dark.png') });

  // ── 1) Geometry tokens match Forge exactly. ──────────────────────
  const geom = await win.evaluate((keys) => {
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    for (const k of keys) out[k] = cs.getPropertyValue(k).trim();
    return out;
  }, Object.keys(EXPECT));
  console.log('[forge] geometry', JSON.stringify(geom));
  for (const [k, v] of Object.entries(EXPECT)) expect(geom[k]).toBe(v);

  // ── 2) Accent is the MONOCHROME token (not teal), and the old stored
  //       teal was migrated away. ─────────────────────────────────────
  const accent = await win.evaluate(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--studio-accent').trim().toLowerCase();
    let stored = null; try { stored = window.localStorage.getItem('studio.v3.accent'); } catch (_) {}
    return { v, stored };
  });
  console.log('[forge] accent', JSON.stringify(accent));
  // Dark monochrome accent is #ebecef (white-ish). Must NOT be teal.
  expect(accent.v).toBe('#ebecef');
  expect(accent.stored).toBeNull(); // teal default migrated away

  // ── 3) No teal in the rendered chrome (signal greens/axis gizmo allowed). ──
  const tealHits = await win.evaluate(() => {
    const isTealAccent = (c) => {
      if (!c) return false;
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return false;
      const r = +m[1], g = +m[2], b = +m[3];
      // teal/cyan accent: strong green+blue, low red, but NOT the success
      // signal green (which is ~#5cc88f → handled, still allowed as signal).
      return r < 80 && g > 180 && b > 150;
    };
    let count = 0;
    document.querySelectorAll('[data-studio-v3-topbar] *, [data-studio-v3-toolbar] *, [data-studio-v3-wb-rail] *').forEach((el) => {
      const st = getComputedStyle(el);
      [st.color, st.backgroundColor, st.borderLeftColor, st.fill].forEach((c) => { if (isTealAccent(c)) count++; });
    });
    return count;
  });
  console.log('[forge] teal hits in topbar/toolbar/rail:', tealHits);
  expect(tealHits).toBe(0);

  // eslint-disable-next-line no-console
  console.log('  slice 744: Forge parity — accent', accent.v, '| geometry matched | teal in chrome:', tealHits);

  await app.close();
});
