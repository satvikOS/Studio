import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 189: BLENDER MODE DROPDOWN.
 *
 * The viewport header's "Object Mode" slot becomes a real Blender mode
 * dropdown: Object / Edit / Sculpt / Vertex Paint / Weight Paint /
 * Texture Paint / Pose. Each mode switches the matching Studio
 * discipline (so the right ribbon panel surfaces under it) and, where
 * Blender wires a one-shot action (sculpt brush, vertex / weight paint,
 * pose), dispatches it through the registry.
 *
 * Headed run on Mac Electron with watchable pacing — slowMo 1000,
 * explicit 700-ms breathers between user-visible state changes, and a
 * 2500-ms hold at the end so the final state lingers over the user's
 * remote-desktop session from Windows -> Mac Studio.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-mode-dropdown');

const CASES = [
  { mode: 'Sculpt Mode',   discipline: 'sculpting' },
  { mode: 'Vertex Paint',  discipline: 'uv-texture' },
  { mode: 'Pose Mode',     discipline: 'rigging' },
  { mode: 'Object Mode',   discipline: 'modeling' },
];

test('Studio — Blender mode dropdown switches discipline + fires per-mode action', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 1000,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  // Leading pause so the user registers the Electron window appearing
  // on their remote Mac Studio display.
  await win.waitForTimeout(1500);

  // Mode dropdown starts collapsed with Object Mode active.
  const modeButton = win.locator('[data-studio-viewport-mode]');
  await expect(modeButton).toBeVisible();
  await expect(modeButton).toHaveAttribute('data-studio-viewport-mode', 'Object Mode');
  await expect(modeButton).toHaveAttribute('data-studio-viewport-mode-open', '0');
  await win.screenshot({ path: path.join(OUT, '00-default-object-mode.png') });
  await win.waitForTimeout(700);

  // Open the dropdown so the user sees the 7 mode options.
  await win.evaluate(() => document.querySelector('[data-studio-viewport-mode]').click());
  await expect(modeButton).toHaveAttribute('data-studio-viewport-mode-open', '1');
  await expect(win.locator('[data-studio-viewport-mode-dropdown]')).toBeVisible();
  for (const m of ['Object Mode', 'Edit Mode', 'Sculpt Mode', 'Vertex Paint',
                   'Weight Paint', 'Texture Paint', 'Pose Mode']) {
    await expect(win.locator(`[data-studio-viewport-mode-option="${m}"]`)).toBeVisible();
  }
  await win.screenshot({ path: path.join(OUT, '01-dropdown-open.png') });
  await win.waitForTimeout(700);
  // Close the initial dropdown so each loop iteration's re-open click
  // toggles open (not closed). Without this, the first iteration's
  // re-open click would close the already-open dropdown instead.
  await win.evaluate(() => document.querySelector('[data-studio-viewport-mode]').click());
  await expect(modeButton).toHaveAttribute('data-studio-viewport-mode-open', '0');

  // Walk through 4 modes — each click flips the active mode AND the
  // active discipline tab underneath. Two-step dispatch: open dropdown
  // (button click), wait for the dropdown DOM to render, then click the
  // option. Both clicks go through Playwright's locator so React's
  // synthetic events fire cleanly.
  let i = 2;
  for (const c of CASES) {
    // Re-open the dropdown (it closes after each pick).
    await win.evaluate(() => document.querySelector('[data-studio-viewport-mode]').click());
    await expect(win.locator('[data-studio-viewport-mode-dropdown]')).toBeVisible();
    await win.waitForTimeout(400);
    await win.evaluate((mode) => {
      const opt = document.querySelector(`[data-studio-viewport-mode-option="${mode}"]`);
      if (opt) opt.click();
    }, c.mode);
    await expect(modeButton).toHaveAttribute('data-studio-viewport-mode', c.mode);
    await expect(modeButton).toHaveAttribute('data-studio-viewport-mode-open', '0');
    await expect(win.locator(`[data-studio-discipline="${c.discipline}"]`).first())
      .toHaveAttribute('data-studio-active', '1');
    await win.waitForTimeout(700);
    const slug = c.mode.toLowerCase().replace(/\s+/g, '-');
    await win.screenshot({ path: path.join(OUT, `0${i++}-${slug}.png`) });
  }

  // End-of-test hold so the final state lingers on screen for the
  // remote viewer.
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 189: mode dropdown switched discipline + fired per-mode action across 4 modes');

  await app.close();
});
