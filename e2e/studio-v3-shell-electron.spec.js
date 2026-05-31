import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-shell');

test('Studio V3 — shell mounts via localStorage flag (slice 393)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 500,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // V2 is default — no V3 shell.
  await expect(win.locator('[data-studio-v3-shell]')).toHaveCount(0);

  // Flip the flag and reload.
  await win.evaluate(() => { window.localStorage.setItem('studioV3', '1'); });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');

  // V3 shell present, default dark mode.
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await expect(win.locator('[data-studio-v3-shell]')).toHaveAttribute('data-studio-v3-mode', 'dark');

  // Logo + wordmark render.
  await expect(win.locator('[data-studio-wordmark]')).toBeVisible();

  // All 15 discipline tabs in the header rail.
  const tabs = win.locator('[data-studio-v3-discipline]');
  await expect(tabs).toHaveCount(15);

  // 4 transform tools in the left rail.
  await expect(win.locator('[data-studio-v3-tool]')).toHaveCount(4);

  // 5 edit-mode chips in the viewport header.
  await expect(win.locator('[data-studio-v3-edit-mode]')).toHaveCount(5);

  // Status bar shows STUDIO + ready dot.
  await expect(win.locator('[data-studio-v3-status-bar]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-status="ready"]')).toContainText('ready');

  // Click a different discipline.
  await win.locator('[data-studio-v3-discipline="render"]').click();
  await expect(win.locator('[data-studio-v3-discipline="render"]'))
    .toHaveAttribute('data-studio-v3-discipline-active', '1');

  // Flip a tool.
  await win.locator('[data-studio-v3-tool="rotate"]').click();
  await expect(win.locator('[data-studio-v3-tool="rotate"]'))
    .toHaveAttribute('data-studio-v3-tool-active', '1');

  // Flip an edit mode → underlying __studioSetEditMode is called.
  await win.locator('[data-studio-v3-edit-mode="vertex"]').click();
  await expect(win.locator('[data-studio-v3-edit-mode="vertex"]'))
    .toHaveAttribute('data-studio-v3-edit-mode-active', '1');

  await win.screenshot({ path: path.join(OUT, '00-dark.png') });

  // Light mode flip.
  await win.evaluate(() => { window.localStorage.setItem('studioV3Theme', 'light'); });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toHaveAttribute('data-studio-v3-mode', 'light');
  await win.screenshot({ path: path.join(OUT, '01-light.png') });

  // Reset flags so the rest of the suite uses V2.
  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studioV3Theme');
  });

  // eslint-disable-next-line no-console
  console.log('  slice 393: V3 shell mounted in dark + light, all rails verified');

  await app.close();
});
