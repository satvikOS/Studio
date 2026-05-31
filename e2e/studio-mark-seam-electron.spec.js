import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-mark-seam');

test('Studio — UV seam marking + list + clear (slice 350)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioMarkEdgeSeam === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  const uuid = await win.evaluate(() => window.__studioSelectedMesh().uuid);

  // Mark edges 0 and 2 as seams.
  const r1 = await win.evaluate(({ u }) => window.__studioMarkEdgeSeam(u, 0), { u: uuid });
  expect(r1.ok).toBe(true);
  expect(r1.marked).toBe(true);
  expect(r1.count).toBe(1);
  const r2 = await win.evaluate(({ u }) => window.__studioMarkEdgeSeam(u, 2), { u: uuid });
  expect(r2.count).toBe(2);

  const seams = await win.evaluate(({ u }) => window.__studioListSeams(u), { u: uuid });
  expect(seams.length).toBe(2);

  // Unmark edge 0.
  const r3 = await win.evaluate(({ u }) => window.__studioMarkEdgeSeam(u, 0, false), { u: uuid });
  expect(r3.count).toBe(1);

  // Clear all.
  const cleared = await win.evaluate(({ u }) => window.__studioClearSeams(u), { u: uuid });
  expect(cleared.cleared).toBe(1);
  const after = await win.evaluate(({ u }) => window.__studioListSeams(u), { u: uuid });
  expect(after.length).toBe(0);

  // Bad edge index returns ok:false.
  const bad = await win.evaluate(({ u }) => window.__studioMarkEdgeSeam(u, 99999), { u: uuid });
  expect(bad.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 350: seam mark/list/unmark/clear all working');

  await app.close();
});
