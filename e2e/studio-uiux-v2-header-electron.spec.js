import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-uiux-v2-header');

test('Studio — UIUX v2 viewport header strip consolidates floating chips (slice 334)', async () => {
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

  // The new viewport header is present.
  await expect(win.locator('[data-studio-viewport-header]')).toBeVisible();

  // Tool icons live inside the header (replacing the slice-317 T-shelf).
  for (const t of ['select', 'move', 'rotate', 'scale']) {
    await expect(win.locator(`[data-studio-tshelf-tool="${t}"]`)).toBeVisible();
  }
  // Axis chips live inside the header (no longer in a floating right-edge rail).
  for (const a of ['top', 'front', 'side', 'persp', 'reset']) {
    await expect(win.locator(`[data-studio-axis-chip="${a}"]`)).toBeVisible();
  }
  // Shading chips (existing slice-321 round buttons in the header).
  for (const m of ['wireframe', 'solid', 'material', 'rendered']) {
    await expect(win.locator(`[data-studio-viewport-shading="${m}"]`)).toBeVisible();
  }

  // Slice 327 op toast (floating pill) is REMOVED — last-op now in status bar text.
  await expect(win.locator('[data-studio-op-toast]')).toHaveCount(0);

  // Click a tool and a shading chip — both should still work end-to-end.
  await win.locator('[data-studio-tshelf-tool="move"]').click();
  await win.waitForTimeout(150);
  expect(await win.evaluate(() => window.__studioActiveTool)).toBe('move');
  await win.locator('[data-studio-viewport-shading="wireframe"]').click();
  await win.waitForTimeout(200);
  // After click, the active shading button has data-studio-viewport-shading-active="1".
  await expect(win.locator('[data-studio-viewport-shading="wireframe"]')).toHaveAttribute('data-studio-viewport-shading-active', '1');

  // Spawn cube via header Add menu chain — last-op should appear in status bar.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-status-lastop]')).toBeVisible();
  await expect(win.locator('[data-studio-status-lastop]')).toHaveAttribute('data-studio-status-lastop-id', 'cube');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 334: UIUX v2 — viewport header strip consolidated floating chips; status-bar last-op text live');

  await app.close();
});
