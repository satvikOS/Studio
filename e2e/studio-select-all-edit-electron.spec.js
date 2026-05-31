import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-select-all-edit');

test('Studio — select-all in edit mode (slice 387)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSelectAllEdit === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0, 0, 0); m.scale.set(1, 1, 1); m.updateMatrixWorld(true);
    window.__studioClearEditSelection();
  });

  // VERTEX → 24 verts.
  let r = await win.evaluate(() => window.__studioSelectAllEdit('vertex'));
  expect(r.ok).toBe(true);
  expect(r.counts.vertices).toBe(24);

  // FACE → 12 triangles.
  r = await win.evaluate(() => window.__studioSelectAllEdit('face'));
  expect(r.counts.faces).toBe(12);

  // EDGE → 30 unique edges.
  r = await win.evaluate(() => window.__studioSelectAllEdit('edge'));
  expect(r.counts.edges).toBe(30);

  // Bad mode.
  const bad = await win.evaluate(() => window.__studioSelectAllEdit('paint'));
  expect(bad.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 387: select-all gives 24 verts / 12 faces / 30 edges');

  await app.close();
});
