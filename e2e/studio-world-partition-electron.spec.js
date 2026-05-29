import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — WORLD PARTITION / STREAMING (headed Electron).
 *
 * Closes the Unreal World Partition / Unity Addressables gap: bucket the scene
 * into a spatial grid and stream cells in/out by distance from an origin. A line
 * of 12 cubes (one per cell) is streamed around two different origins; verifies
 * only the cells near each origin stay resident (visible) while distant cells are
 * streamed out — and that moving the origin swaps which cubes are resident.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-world-partition');

test('Studio — world partition streams cells in/out by distance', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioStreamAround === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  // 12 cubes laid out one per 0.5-unit cell along X (centred in the cell)
  for (let i = 0; i < 12; i++) { await win.locator('[data-studio-primitive="cube"]').click(); }
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const s = window.__archdiscScene; const a = [];
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') a.push(o); });
    a.forEach((o, i) => o.position.set(i * 0.5 + 0.25, 0, 0));
  });
  const vis = () => win.evaluate(() => {
    const s = window.__archdiscScene; const a = [];
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') a.push(o); });
    return a.map((o) => o.visible);
  });

  // ── stream around the left end -> only the first cells resident ──
  const s1 = await win.evaluate(() => window.__studioStreamAround([0.25, 0, 0], 0.5, 1));
  const v1 = await vis();
  expect(s1.active, 'only a few cells resident near the origin').toBeLessThanOrEqual(3);
  expect(s1.culled, 'distant cells streamed out').toBeGreaterThan(7);
  expect(v1[0], 'cube at the origin cell is resident').toBe(true);
  expect(v1[10], 'a far cube is streamed out').toBe(false);
  await win.evaluate(() => { window.__archdiscOrbitView && window.__archdiscOrbitView(16, 30, 2.4); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-streamed-left.png') });

  // ── move the origin to the right end -> the resident set SWAPS ──
  const s2 = await win.evaluate(() => window.__studioStreamAround([5.25, 0, 0], 0.5, 1));
  const v2 = await vis();
  expect(v2[10], 'far cube becomes resident when the origin moves to it').toBe(true);
  expect(v2[0], 'the previously-resident cube is now streamed out').toBe(false);
  expect(s2.active, 'still only a few cells resident').toBeLessThanOrEqual(3);
  await win.evaluate(() => { window.__archdiscOrbitView && window.__archdiscOrbitView(16, 30, 2.4); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '02-streamed-right.png') });

  // ── reveal all -> every cell resident again ──
  const r = await win.evaluate(() => window.__studioRevealAll());
  const v3 = await vis();
  expect(r.active, 'reveal-all restores every object').toBe(12);
  expect(v3.every((x) => x === true), 'all cubes visible after reveal-all').toBe(true);

  // eslint-disable-next-line no-console
  console.log(`  world partition: left-origin active=${s1.active}/${s1.total} (cube0=${v1[0]}, cube10=${v1[10]}); right-origin cube0=${v2[0]}, cube10=${v2[10]}; reveal active=${r.active}`);

  await app.close();
});
