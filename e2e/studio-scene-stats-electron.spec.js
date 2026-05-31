import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-scene-stats');

test('Studio — __studioListSceneStats diagnostic snapshot (slice 364)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioListSceneStats === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Empty scene: count 0.
  const empty = await win.evaluate(() => window.__studioListSceneStats());
  expect(empty.ok).toBe(true);
  expect(empty.count).toBe(0);
  expect(empty.totalVerts).toBe(0);

  // Spawn cube + sphere.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);

  const stats = await win.evaluate(() => window.__studioListSceneStats());
  expect(stats.count).toBe(2);
  expect(stats.totalVerts).toBeGreaterThan(0);
  expect(stats.meshes.length).toBe(2);
  const kinds = stats.meshes.map(m => m.kind).sort();
  expect(kinds).toEqual(['cube', 'sphere']);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 364: scene-stats — kinds=', kinds, 'totalVerts=', stats.totalVerts);

  await app.close();
});
