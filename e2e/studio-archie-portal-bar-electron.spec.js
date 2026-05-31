import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-archie-portal-bar');

test('Studio — Archie portal floating bar + Studio brand (slice 335)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 700,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Studio brand attribute is set on the viewport header.
  await expect(win.locator('[data-studio-brand="v2"]')).toBeVisible();

  // Tool-selector chips use the new letter labels (sel / mov / rot / scl).
  for (const tool of ['select', 'move', 'rotate', 'scale']) {
    await expect(win.locator(`[data-studio-tshelf-tool="${tool}"]`)).toBeVisible();
  }
  await expect(win.locator('[data-studio-tshelf-tool="select"]')).toHaveText(/sel/i);

  // Archie portal bar is always visible.
  await expect(win.locator('[data-studio-archie-portal]')).toBeVisible();
  await expect(win.locator('[data-studio-archie-input]')).toBeVisible();
  await expect(win.locator('[data-studio-archie-run]')).toBeVisible();
  await expect(win.locator('[data-studio-archie-run]')).toHaveText(/run/i);

  // Typing into the portal input mirrors to aiPrompt state.
  const inp = win.locator('[data-studio-archie-input]');
  await inp.click();
  await inp.press('ControlOrMeta+A');
  await inp.type('add a cube');
  await win.waitForTimeout(150);
  // Run button is enabled when prompt is non-empty.
  await expect(win.locator('[data-studio-archie-run]')).toBeEnabled();

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 335: Studio brand attribute + Archie portal bar visible');

  await app.close();
});
