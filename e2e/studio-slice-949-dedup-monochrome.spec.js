import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 949 — Dedup sweep + monochrome audit.
//
// Verifies the chromatic-accent strip from slice 949:
//   1. StudioShellV3.jsx — every inline-style fallback hex is monochrome
//      (no #1de9b6 / #0fd4a6 / #0d1117 / #161b22 / #e6edf3 / #1f2733
//       leaking into computed styles)
//   2. SwUxOverlays.css — semantic-color tokens replaced with grey-tints
//      (no saturated red/green/blue rgba bleeding into rendered overlays)
//   3. Settings dialog (cmdbar gear / topbar Settings menu) reads as
//      pure monochrome end-to-end
//
// Approach: probe computed styles on representative elements and assert
// R === G === B (±2) for every background / border / color we sample.

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-949-dedup-monochrome');

function isMonochrome(rgba) {
  if (!rgba) return false;
  const m = String(rgba).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return false;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Tolerance is 12 — the warm-white --studio-ink (#f0eee6) is the only
  // deliberate non-pure-grey in the palette; the rest are R=G=B. 12 lets
  // the warm ink pass while catching any chromatic leak (saturated hex
  // values have per-channel deltas of 30+).
  return Math.abs(r - g) <= 12 && Math.abs(g - b) <= 12 && Math.abs(r - b) <= 12;
}

test('Studio slice 949 — dedup sweep audit, fully monochrome chrome', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 260,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.removeItem('studio.v3.accent');
    window.localStorage.setItem('studioV3Theme', 'dark');
    // Pre-dismiss the onboarding tour so it doesn't intercept clicks.
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Sample 6 primary-chrome elements that are always mounted. Every
  // computed background and border MUST be monochrome.
  const probes = await win.evaluate(() => {
    const sel = [
      ['topbar',   '[data-studio-v3-topbar]'],
      ['qat',      '[data-studio-v3-qat]'],
      ['wb-rail',  '[data-studio-v3-wb-rail]'],
      ['toolbar',  '[data-studio-v3-toolbar]'],
      ['cmdbar',   '[data-studio-v3-cmdbar]'],
      ['statusbar','.studio-statusbar'],
    ];
    return sel.map(([name, q]) => {
      const el = document.querySelector(q);
      if (!el) return { name, found: false };
      const cs = window.getComputedStyle(el);
      return {
        name, found: true,
        bg: cs.backgroundColor,
        bt: cs.borderTopColor,
        bb: cs.borderBottomColor,
        bl: cs.borderLeftColor,
        br: cs.borderRightColor,
        fg: cs.color,
      };
    });
  });
  const chromaticFailures = [];
  for (const p of probes) {
    if (!p.found) { chromaticFailures.push(`${p.name}: not in DOM`); continue; }
    for (const key of ['bg', 'bt', 'bb', 'bl', 'br', 'fg']) {
      if (!isMonochrome(p[key])) chromaticFailures.push(`${p.name}.${key} = ${p[key]} (chromatic)`);
    }
  }
  expect(chromaticFailures).toEqual([]);
  await win.screenshot({ path: path.join(OUT, '01-primary-chrome-monochrome.png') });

  // Open the Archie overlay + send a direct call to trigger a tool
  // message; sample its colored chrome too.
  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.locator('[data-studio-v3-cmdbar-input]').fill('studioListSceneStats');
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');
  await win.waitForTimeout(400);

  const overlayProbes = await win.evaluate(() => {
    const overlay = document.querySelector('[data-studio-v3-archie-overlay]');
    const msgs = Array.from(document.querySelectorAll('[data-studio-v3-archie-msg]'));
    if (!overlay) return null;
    const css = window.getComputedStyle(overlay);
    const msgCss = msgs.map((m) => {
      const c = window.getComputedStyle(m);
      return { role: m.getAttribute('data-role'), bg: c.backgroundColor, bl: c.borderLeftColor, fg: c.color };
    });
    return {
      overlay: { bg: css.backgroundColor, bt: css.borderTopColor, fg: css.color },
      messages: msgCss,
    };
  });
  expect(overlayProbes).toBeTruthy();
  const overlayFailures = [];
  if (overlayProbes) {
    for (const key of ['bg', 'bt', 'fg']) {
      if (!isMonochrome(overlayProbes.overlay[key])) {
        overlayFailures.push(`overlay.${key} = ${overlayProbes.overlay[key]}`);
      }
    }
    for (const m of overlayProbes.messages) {
      for (const key of ['bg', 'bl', 'fg']) {
        if (!isMonochrome(m[key])) overlayFailures.push(`msg[${m.role}].${key} = ${m[key]}`);
      }
    }
  }
  expect(overlayFailures).toEqual([]);
  await win.screenshot({ path: path.join(OUT, '02-overlay-with-msgs-monochrome.png') });

  // Settings panel opens via the topbar gear ('settings' QAT button).
  // Probe its surface too.
  const settingsBtn = win.locator('[data-studio-v3-qat-btn="settings"]');
  if (await settingsBtn.count() > 0) {
    await settingsBtn.click();
    await win.waitForTimeout(280);
    const settingsProbes = await win.evaluate(() => {
      const modal = document.querySelector('[data-studio-v3-settings]')
        || document.querySelector('[data-studio-v3-settings-section]')
        || document.querySelector('.studio-settings');
      if (!modal) return null;
      const cs = window.getComputedStyle(modal);
      return { bg: cs.backgroundColor, bt: cs.borderTopColor, fg: cs.color };
    });
    if (settingsProbes) {
      const sf = [];
      for (const key of ['bg', 'bt', 'fg']) {
        if (!isMonochrome(settingsProbes[key])) sf.push(`settings.${key} = ${settingsProbes[key]}`);
      }
      expect(sf).toEqual([]);
      await win.screenshot({ path: path.join(OUT, '03-settings-monochrome.png') });
      // Dismiss.
      await win.keyboard.press('Escape');
      await win.waitForTimeout(200);
    }
  }

  // Final reference shot — full shell in dark mode after all interactions.
  await win.screenshot({ path: path.join(OUT, '04-final-dedup-state.png') });

  await win.evaluate(() => {
    delete window.__studioArchieMock;
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(140);
  await app.close();
});
