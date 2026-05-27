import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 2 — Studio workbench is the app's default surface, and the
 * workbench switcher round-trips cleanly between Studio and the
 * inherited Mech-era Mechanical CAD workbench.
 *
 * This spec drives the entire user workflow as a real human would —
 * launching the Electron desktop app, seeing the Studio workbench
 * already active, opening the workbench dropdown, clicking through
 * to Mechanical CAD, then clicking back to Studio. Key-frame
 * screenshots are captured at every meaningful step of the flow,
 * per Studio's e2e mandate (real Electron launch + real user
 * gestures + visual verification).
 *
 * Inherited from Mech feedback: never inject pre-built UI state via
 * window globals; only ribbon/menu/dialog interactions, the same
 * surface a future AI orchestration step or a literal human will use.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-workbench-switching');

test('Studio is the default workbench and the switcher round-trips to Mechanical CAD and back', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 400, // workflow spec — pace each click so the watcher follows the flow
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // Wait for the React render to settle: the workbench switcher button
  // must exist with a current workbench name.
  await expect(win.locator('.workbench-current .workbench-name')).toBeVisible({ timeout: 30000 });

  // ---- KEY-FRAME 1: Studio is the default workbench on app open ----
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', {
    timeout: 30000,
  });
  // Studio's distinctive ribbon placeholder must be on screen.
  await expect(win.locator('[data-archdisc-ribbon-placeholder="studio"]')).toBeVisible({ timeout: 30000 });
  // All 8 discipline tabs render.
  await expect(win.locator('[data-studio-discipline]')).toHaveCount(8);
  // Left toolbar wired with the 11 Studio tools.
  await expect(win.locator('[data-studio-tool]')).toHaveCount(11);
  // Wait briefly for the canvas to paint so the screenshot is meaningful.
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForTimeout(1200);
  await win.screenshot({
    path: path.join(OUT, '01-studio-default.png'),
    fullPage: false,
  });

  // ---- KEY-FRAME 2: open the workbench switcher dropdown (real user click) ----
  await win.locator('.workbench-current').click();
  // The dropdown panel becomes visible.
  await expect(win.locator('.workbench-dropdown')).toBeVisible({ timeout: 5000 });
  // ArchDisc Studio must be marked as the currently active option.
  await expect(
    win.locator('.workbench-option.active .workbench-name')
  ).toHaveText('ArchDisc Studio', { timeout: 5000 });
  // All 6 workbenches in the inherited list are present (Studio + 5 Mech-era).
  await expect(win.locator('.workbench-option')).toHaveCount(6);
  await win.waitForTimeout(400);
  await win.screenshot({
    path: path.join(OUT, '02-switcher-dropdown-open.png'),
    fullPage: false,
  });

  // ---- KEY-FRAME 3: click "Mechanical CAD" → Mech CAD workbench renders ----
  await win.locator('.workbench-option', { hasText: 'Mechanical CAD' }).click();
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('Mechanical CAD', {
    timeout: 10000,
  });
  // The Studio ribbon should be gone; Mech's CAD ribbon should be present.
  // (WorkbenchMechanical.jsx renders a real ribbon, not the placeholder.)
  await expect(win.locator('[data-archdisc-ribbon-placeholder="studio"]')).toHaveCount(0);
  await win.waitForTimeout(1200);
  await win.screenshot({
    path: path.join(OUT, '03-switched-to-mechanical-cad.png'),
    fullPage: false,
  });

  // ---- KEY-FRAME 4: open switcher again, click ArchDisc Studio to return ----
  await win.locator('.workbench-current').click();
  await expect(win.locator('.workbench-dropdown')).toBeVisible({ timeout: 5000 });
  await win.waitForTimeout(300);
  await win.screenshot({
    path: path.join(OUT, '04-switcher-dropdown-on-mech.png'),
    fullPage: false,
  });
  await win.locator('.workbench-option', { hasText: 'ArchDisc Studio' }).click();
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', {
    timeout: 10000,
  });
  // Studio ribbon back in place.
  await expect(win.locator('[data-archdisc-ribbon-placeholder="studio"]')).toBeVisible({ timeout: 10000 });
  await win.waitForTimeout(1200);
  await win.screenshot({
    path: path.join(OUT, '05-back-to-studio.png'),
    fullPage: false,
  });

  // ---- KEY-FRAME 5: a couple of Studio-internal interactions ----
  // Click the Sculpting discipline tab inside the Studio ribbon (real click).
  await win.locator('[data-studio-discipline="sculpting"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-discipline="sculpting"]')).toHaveClass(/active/);
  // Click a different left-toolbar tool.
  await win.locator('[data-studio-tool="sculpt"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-tool="sculpt"]')).toHaveClass(/active/);
  await win.screenshot({
    path: path.join(OUT, '06-studio-sculpt-mode.png'),
    fullPage: false,
  });

  // Final sanity log so the test output names the path of clicks.
  // eslint-disable-next-line no-console
  console.log('  workflow:', [
    'launch', 'studio-default-visible',
    'open-switcher', 'click-mech',
    'mech-visible', 'reopen-switcher', 'click-studio',
    'studio-visible', 'click-sculpting-tab', 'click-sculpt-tool',
  ].join(' → '));

  await app.close();
});
