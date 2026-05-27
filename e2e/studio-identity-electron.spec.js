import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 1 — Studio identity in the running ArchDisc Studio desktop app.
 *
 * Launches the packaged Electron entry point (loads frontend/dist via
 * electron/main.js, NOT a browser context) and verifies the user-visible
 * identity strings have moved from "ArchDisc" (Mech) to "ArchDisc Studio":
 *
 *   1. The OS window title (sourced from <title> in frontend/index.html
 *      and the BrowserWindow.title default in electron/main.js).
 *   2. The h1 inside .workbench-header (rendered by Workbench.jsx).
 *
 * Visual verification: full-window screenshot + a tight header crop where
 * the "ArchDisc Studio" h1 is the focal element. Per Studio's e2e mandate
 * (see ~/.claude memory feedback-studio-e2e-electron-only): real Electron
 * launch, no browser context, real user-visible UI.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-identity');

test('Studio identity is rendered as "ArchDisc Studio" in the running Electron app', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // document.title (= the OS-level Electron window title once index.html is loaded)
  await expect
    .poll(async () => await win.title(), {
      timeout: 30000,
      message: 'expected document title to contain "ArchDisc Studio"',
    })
    .toContain('ArchDisc Studio');

  // The visible header rendered by Workbench.jsx.
  await expect(win.locator('.workbench-title')).toHaveText('ArchDisc Studio', { timeout: 30000 });

  // Wait for the rest of the workbench to settle so the screenshot has full
  // chrome (ribbon, viewport canvas, side panels) — not just a half-painted
  // header.
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  // Brief settle for one-shot intro animations.
  await win.waitForTimeout(1500);

  // Key-frame 1 — entire Electron window. This is the headline visual proof.
  await win.screenshot({
    path: path.join(OUT, 'studio-identity-full-window.png'),
    fullPage: false,
  });

  // Key-frame 2 — tight crop on the header so the "ArchDisc Studio" h1 is the
  // focal element and the asserted change is unambiguous in review.
  const headerBox = await win.locator('.workbench-header').first().boundingBox();
  if (headerBox) {
    await win.screenshot({
      path: path.join(OUT, 'studio-identity-header-crop.png'),
      clip: headerBox,
    });
  }

  // Sanity log so the test output names what landed.
  // eslint-disable-next-line no-console
  console.log('  document.title:', await win.title());
  // eslint-disable-next-line no-console
  console.log('  .workbench-title text:', await win.locator('.workbench-title').textContent());

  await app.close();
});
