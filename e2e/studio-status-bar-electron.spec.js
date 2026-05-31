import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-status-bar');

test('Studio — Blender bottom status bar (slice 315)', async () => {
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

  // Status bar is always visible.
  await expect(win.locator('[data-studio-viewport-status-bar]')).toBeVisible();
  await expect(win.locator('[data-studio-status-bodies]')).toHaveText('Scene: 0 bodies');

  // Spawn a cube — body count goes 1, selected name updates.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-status-bodies]')).toHaveText('Scene: 1 bodies');
  await expect(win.locator('[data-studio-status-selected-name]')).not.toHaveText('(no active)');

  const vertsText = await win.locator('[data-studio-status-verts]').textContent();
  const vMatch = vertsText.match(/V:\s*([0-9,]+)/);
  expect(vMatch).toBeTruthy();
  const verts = parseInt(vMatch[1].replace(/,/g, ''), 10);
  expect(verts).toBeGreaterThan(0);

  // FPS should populate after ~30 frames (≈ half a second on 60Hz).
  await win.waitForTimeout(1200);
  const fpsText = await win.locator('[data-studio-status-fps]').textContent();
  const fpsMatch = fpsText.match(/FPS:\s*(\d+)/);
  expect(fpsMatch).toBeTruthy();
  expect(parseInt(fpsMatch[1], 10)).toBeGreaterThanOrEqual(1);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 315: status bar — verts=', verts, 'fps=', fpsMatch[1]);

  await app.close();
});
