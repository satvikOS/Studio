import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 188: BLENDER 3D-VIEWPORT HEADER STRIP.
 *
 * Adds Blender's per-editor header strip at the top of the 3D viewport.
 * Left side: editor-type label + Object Mode indicator. Center: View /
 * Add / Object menu stubs. Right side: 4 round shading-mode buttons
 * (Wireframe / Solid / Material / Rendered) — Blender's iconic shading
 * toggle. Active shading is highlighted and fires the existing shade-*
 * ribbon actions so a single source of truth.
 *
 * Headed Mac Electron run per the watchable-tests rule.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-viewport-header');

test('Studio — Blender viewport header: shading-mode toggle (headed)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 320,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(400);

  // Header strip mounted with all expected parts.
  await expect(win.locator('[data-studio-viewport-header]')).toBeVisible();
  await expect(win.locator('[data-studio-viewport-header-label]')).toHaveText('3D Viewport');
  await expect(win.locator('[data-studio-viewport-mode]')).toHaveText('Object Mode');
  for (const m of ['View', 'Add', 'Object']) {
    await expect(win.locator(`[data-studio-viewport-menu="${m}"]`)).toBeVisible();
  }
  for (const s of ['wireframe', 'solid', 'material', 'rendered']) {
    await expect(win.locator(`[data-studio-viewport-shading="${s}"]`)).toBeVisible();
  }
  // Default shading: Solid.
  await expect(win.locator('[data-studio-viewport-shading="solid"]'))
    .toHaveAttribute('data-studio-viewport-shading-active', '1');
  await win.screenshot({ path: path.join(OUT, '00-default-solid.png') });

  // Walk through the 4 shading modes. Each click flips the active button
  // and (for the 3 non-wireframe modes) fires its shade-* ribbon action.
  for (const mode of ['material', 'rendered', 'wireframe', 'solid']) {
    await win.evaluate((m) => {
      const btn = document.querySelector(`[data-studio-viewport-shading="${m}"]`);
      if (btn) btn.click();
    }, mode);
    await win.waitForTimeout(200);
    await expect(win.locator(`[data-studio-viewport-shading="${mode}"]`))
      .toHaveAttribute('data-studio-viewport-shading-active', '1');
    // Other 3 buttons inactive.
    for (const other of ['wireframe', 'solid', 'material', 'rendered']) {
      if (other === mode) continue;
      await expect(win.locator(`[data-studio-viewport-shading="${other}"]`))
        .toHaveAttribute('data-studio-viewport-shading-active', '0');
    }
    await win.screenshot({ path: path.join(OUT, `0${1 + ['material', 'rendered', 'wireframe', 'solid'].indexOf(mode)}-${mode}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 188: viewport header + shading-mode 4-toggle working end-to-end');

  await app.close();
});
