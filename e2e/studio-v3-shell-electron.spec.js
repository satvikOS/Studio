import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-shell');

test('Studio V3 — Forge-style shell mounts, all zones present (slice 394)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 500,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // Reset all V3 localStorage to a known state, then flip the V3 flag.
  await win.evaluate(() => {
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    window.localStorage.setItem('studioV3', '1');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');

  const shell = win.locator('[data-studio-v3-shell]');
  await expect(shell).toBeVisible({ timeout: 15000 });
  await expect(shell).toHaveAttribute('data-studio-v3-mode', 'dark');

  // All 7 zones render.
  await expect(win.locator('[data-studio-v3-topbar]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-qat]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-wb-rail]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-toolbar]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-viewport]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-statusbar]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-cmdbar]')).toBeVisible();

  // Logo + wordmark in topbar.
  await expect(win.locator('[data-studio-wordmark]').first()).toBeVisible();

  // 15 discipline tabs in wb-rail.
  await expect(win.locator('[data-studio-v3-wb]')).toHaveCount(15);

  // QAT buttons present.
  await expect(win.locator('[data-studio-v3-qat-btn="save"]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-qat-btn="undo"]')).toBeVisible();

  // Default discipline is Model — toolbar groups Add / Transform / Mesh / View.
  for (const g of ['add', 'transform', 'mesh', 'view']) {
    await expect(win.locator(`[data-studio-v3-toolbar-group="${g}"]`)).toBeVisible();
  }

  // Viewport HUD: 5 edit-mode buttons + 4 axis chips.
  await expect(win.locator('[data-studio-v3-edit-mode]')).toHaveCount(5);
  await expect(win.locator('[data-studio-v3-axis]')).toHaveCount(4);

  // Right panel — 3 tabs.
  await expect(win.locator('[data-studio-v3-right-tab]')).toHaveCount(3);

  // Status bar shows ready dot.
  await expect(win.locator('[data-studio-v3-status="ready"]')).toContainText('ready');

  // Command bar input present.
  await expect(win.locator('[data-studio-v3-cmdbar-input]')).toBeVisible();

  await win.screenshot({ path: path.join(OUT, '00-shell-dark.png'), fullPage: false });

  // ─── Interactions ────────────────────────────────────────────────────────

  // Switch to Render discipline → toolbar groups swap.
  await win.locator('[data-studio-v3-wb="render"]').click();
  await expect(win.locator('[data-studio-v3-wb="render"]')).toHaveAttribute('data-active', 'true');
  await expect(win.locator('[data-studio-v3-toolbar-group="capture"]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '01-render-dark.png') });

  // Back to Model.
  await win.locator('[data-studio-v3-wb="model"]').click();

  // Activate the Move tool — Transform group is toggle-style.
  await win.locator('[data-studio-v3-tool="move"][data-studio-v3-tool-group="transform"]').click();
  await expect(win.locator('[data-studio-v3-tool="move"][data-studio-v3-tool-group="transform"]'))
    .toHaveAttribute('data-active', 'true');

  // Flip edit mode via HUD.
  await win.locator('[data-studio-v3-edit-mode="vertex"]').click();
  await expect(win.locator('[data-studio-v3-edit-mode="vertex"]')).toHaveAttribute('data-active', 'true');

  // Open Archie dock.
  await win.locator('[data-studio-v3-cmdbar-toggle]').click();
  await expect(win.locator('[data-studio-v3-archie]')).toBeVisible();
  await expect(shell).toHaveAttribute('data-archie-open', 'true');
  await win.screenshot({ path: path.join(OUT, '02-archie-open.png') });

  // Close dock.
  await win.locator('[data-studio-v3-archie-close]').click();
  await expect(win.locator('[data-studio-v3-archie]')).toHaveCount(0);

  // Collapse + expand the right panel.
  await win.locator('[data-studio-v3-right-collapse]').click();
  await expect(win.locator('[data-studio-v3-right]')).toHaveAttribute('data-collapsed', 'true');
  await win.locator('[data-studio-v3-right-expand]').click();
  await expect(win.locator('[data-studio-v3-right]')).toHaveAttribute('data-collapsed', 'false');

  // Theme flip via the topbar Dark/Light button.
  await win.locator('[data-studio-v3-theme-toggle]').click();
  await expect(shell).toHaveAttribute('data-studio-v3-mode', 'light');
  await win.screenshot({ path: path.join(OUT, '03-shell-light.png') });

  // Reset.
  await win.locator('[data-studio-v3-theme-toggle]').click();
  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log('  slice 394: 7-zone V3 shell + dark/light + archie dock + right collapse all verified');

  await app.close();
});
