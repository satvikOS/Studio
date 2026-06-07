import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 950 — Full-platform coherence headed e2e.
//
// Walks every one of the 9 canonical disciplines, captures:
//   1. The default state of the discipline (toolbar visible, ribbon clean)
//   2. A tool from the discipline's first group invoked
//   3. An Archie-driven command executed against the same discipline
// Then validates:
//   • Every discipline renders ≥1 toolbar group
//   • Every discipline has zero chromatic chrome (computed-style probe)
//   • Archie routing works in every mode (mocked plan dispatches correctly)
//   • No zombie surfaces — no leftover legacy V2 chrome, no orphan
//     floating chips, no duplicate menus
//
// One spec, one Electron boot, 9 disciplines × 3 screenshots = 27 visual
// frames + a final overview.

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-950-full-coherence');

const DISCIPLINES = [
  'model', 'sculpt', 'uv', 'shade', 'animate',
  'render', 'compose', 'sim', 'layout',
];

function isMonochrome(rgba) {
  if (!rgba) return false;
  const m = String(rgba).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return false;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return Math.abs(r - g) <= 12 && Math.abs(g - b) <= 12 && Math.abs(r - b) <= 12;
}

test('Studio slice 950 — full-platform coherence across all 9 disciplines', async () => {
  test.setTimeout(420000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 200,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.removeItem('studio.v3.accent');
    window.localStorage.setItem('studioV3Theme', 'dark');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Inject the Archie mock once — each discipline test invokes it.
  await win.evaluate(() => {
    window.__studioArchieDispatched = [];
    window.__studioArchieMock = (text) => {
      const m = text.match(/go to (\w+)/);
      const target = m ? m[1] : 'model';
      window.__studioArchieDispatched.push(target);
      return [
        `Switching to ${target}.`,
        `<tool_call>{"name":"click-discipline","arguments":{"id":"${target}"}}</tool_call>`,
      ].join('\n');
    };
  });

  // Track every discipline's monochrome audit + zombie surface check.
  const report = { perDiscipline: {}, zombies: [], summary: '' };

  for (const disc of DISCIPLINES) {
    // 1. Click the tab.
    await win.locator(`[data-studio-v3-wb="${disc}"]`).click();
    await win.waitForTimeout(220);

    // 2. Verify toolbar rendered + per-discipline groups are present.
    const groupCount = await win.locator('[data-studio-v3-toolbar-group]').count();
    expect(groupCount).toBeGreaterThan(0);

    // 3. Probe the toolbar's computed style for monochrome.
    const tbStyle = await win.evaluate(() => {
      const tb = document.querySelector('[data-studio-v3-toolbar]');
      if (!tb) return null;
      const c = window.getComputedStyle(tb);
      return { bg: c.backgroundColor, bb: c.borderBottomColor, fg: c.color };
    });
    expect(tbStyle).toBeTruthy();
    const chromatic = tbStyle && (
      !isMonochrome(tbStyle.bg) ||
      !isMonochrome(tbStyle.bb) ||
      !isMonochrome(tbStyle.fg)
    );
    report.perDiscipline[disc] = { tbStyle, chromatic };

    // 4. Default capture.
    await win.screenshot({ path: path.join(OUT, `${disc}-01-default.png`) });

    // 5. Click the first add-group tool if it exists.
    const firstAdd = win.locator('[data-studio-v3-tool-group="add"] [data-studio-v3-tool]').first();
    if (await firstAdd.count() > 0) {
      await firstAdd.click();
      await win.waitForTimeout(180);
      await win.screenshot({ path: path.join(OUT, `${disc}-02-tool-clicked.png`) });
    }

    // 6. Send an Archie command targeted at this discipline.
    await win.locator('[data-studio-v3-cmdbar-input]').click();
    await win.locator('[data-studio-v3-cmdbar-input]').fill(`go to ${disc}`);
    await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');
    await win.waitForTimeout(500);
    await win.screenshot({ path: path.join(OUT, `${disc}-03-archie-routed.png`) });
  }

  // 7. Validate every discipline survived the audit.
  const chromaticDisciplines = Object.entries(report.perDiscipline)
    .filter(([, r]) => r.chromatic).map(([d]) => d);
  expect(chromaticDisciplines).toEqual([]);

  // 8. Validate every Archie command dispatched.
  const dispatched = await win.evaluate(() => window.__studioArchieDispatched || []);
  expect(dispatched).toEqual(DISCIPLINES);

  // 9. Zombie surface check — no V2 monolith DOM markers, no legacy
  //    AIConsole chrome, no duplicate Archie panels.
  const zombies = await win.evaluate(() => {
    const out = [];
    // V2 legacy markers that should not appear under the V3-only shell.
    const checks = [
      ['legacy-ai-console',     '[data-archdisc-ai-console]'],
      ['legacy-statusbarpro',   '.statusbar-pro:not([data-studio-v3-statusbar])'],
      ['legacy-workbench-hdr',  '.workbench-header'],
      ['legacy-cmdpalette',     '.command-palette[data-legacy]'],
      ['inline-archie-thread',  '[data-studio-v3-archie-thread]'],
    ];
    for (const [name, sel] of checks) {
      const found = document.querySelector(sel);
      if (found) out.push(`${name}: ${sel}`);
    }
    // Duplicate cmdbar guard.
    const cmdbars = document.querySelectorAll('[data-studio-v3-cmdbar]').length;
    if (cmdbars !== 1) out.push(`cmdbar count = ${cmdbars} (expected 1)`);
    // Duplicate shell guard.
    const shells = document.querySelectorAll('[data-studio-v3-shell]').length;
    if (shells !== 1) out.push(`shell count = ${shells} (expected 1)`);
    return out;
  });
  expect(zombies).toEqual([]);

  // CAM final — full-app reference frame.
  await win.locator('[data-studio-v3-wb="model"]').click();
  await win.waitForTimeout(220);
  await win.evaluate(() => { delete window.__studioArchieMock; });
  await win.screenshot({ path: path.join(OUT, 'zz-final-reference.png') });

  // 10. Cleanup.
  await win.evaluate(() => {
    delete window.__studioArchieDispatched;
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(140);
  await app.close();
});
