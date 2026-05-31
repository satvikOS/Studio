import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-edit-sel-counts');

test('Studio — edit-mode selection-count badge (slice 383)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 500,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await expect(win.locator('[data-studio-edit-mode-chip="object"]')).toBeVisible({ timeout: 10000 });

  // Spawn cube.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);

  // Object mode → badge is hidden.
  await expect(win.locator('[data-studio-edit-sel-counts]')).toHaveCount(0);

  // Flip to vertex mode → badge appears with 0 counts.
  await win.locator('[data-studio-edit-mode-chip="vertex"]').click();
  const badge = win.locator('[data-studio-edit-sel-counts]');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('data-studio-edit-sel-verts', '0');

  // Programmatic pick → counts update via the studio-pick event.
  await win.evaluate(() => {
    const r = { ok: true, vertIdx: 0 };
    window.dispatchEvent(new CustomEvent('studio-pick', { detail: { mode: 'vertex', result: r, additive: false } }));
  });
  await expect(badge).toHaveAttribute('data-studio-edit-sel-verts', '1');

  // Add a second vert.
  await win.evaluate(() => {
    const r = { ok: true, vertIdx: 5 };
    window.dispatchEvent(new CustomEvent('studio-pick', { detail: { mode: 'vertex', result: r, additive: true } }));
  });
  await expect(badge).toHaveAttribute('data-studio-edit-sel-verts', '2');

  // Flip to edge — verts stay until the next replace; add an edge.
  await win.locator('[data-studio-edit-mode-chip="edge"]').click();
  await expect(badge).toBeVisible();
  await win.evaluate(() => {
    const r = { ok: true, vertIdx: [0, 1] };
    window.dispatchEvent(new CustomEvent('studio-pick', { detail: { mode: 'edge', result: r, additive: false } }));
  });
  await expect(badge).toHaveAttribute('data-studio-edit-sel-edges', '1');

  // Back to object → badge disappears.
  await win.locator('[data-studio-edit-mode-chip="object"]').click();
  await expect(win.locator('[data-studio-edit-sel-counts]')).toHaveCount(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 383: badge tracks vertex / edge counts live');

  await app.close();
});
