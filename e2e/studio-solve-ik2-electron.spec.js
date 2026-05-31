import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-solve-ik2');

test('Studio — Cascadeur 2-bone analytic IK solver (slice 289)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSolveIK2 === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Reachable target.
  const r1 = await win.evaluate(() => window.__studioSolveIK2({
    rootPos: [0, 0, 0], midPos: [0, 1, 0], endPos: [0, 2, 0],
    targetPos: [1, 1, 0], poleHint: [0, 0, 1],
  }));
  expect(r1).toBeTruthy();
  expect(r1.L1).toBeCloseTo(1, 5);
  expect(r1.L2).toBeCloseTo(1, 5);
  expect(r1.totalLen).toBeCloseTo(2, 5);
  expect(r1.reach).toBeCloseTo(Math.sqrt(2), 5);
  expect(r1.clamped).toBe(false);
  expect(Array.isArray(r1.rootRot) && r1.rootRot.length === 3).toBe(true);
  expect(Array.isArray(r1.midRot) && r1.midRot.length === 3).toBe(true);
  // Solver converged: end ≈ target within 0.02.
  const dx = r1.solvedEnd[0] - 1, dy = r1.solvedEnd[1] - 1, dz = r1.solvedEnd[2] - 0;
  expect(Math.hypot(dx, dy, dz)).toBeLessThan(0.02);

  // Out-of-reach target (must clamp).
  const r2 = await win.evaluate(() => window.__studioSolveIK2({
    rootPos: [0, 0, 0], midPos: [0, 1, 0], endPos: [0, 2, 0],
    targetPos: [5, 0, 0], poleHint: [0, 0, 1],
  }));
  expect(r2.clamped).toBe(true);
  // Bend should be near π (straight) when clamped — cos(π-π) ≈ 1 so bendAngle ≈ 0.
  expect(r2.bendAngle).toBeLessThan(0.05);
  // Solved end should lie on the +X ray, within (totalLen - epsilon).
  expect(Math.hypot(r2.solvedEnd[0], r2.solvedEnd[1], r2.solvedEnd[2])).toBeCloseTo(2, 2);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2000);

  // eslint-disable-next-line no-console
  console.log('  slice 289: IK2 solver — reachable converged to', r1.solvedEnd.map(v => v.toFixed(3)), '; clamped distance', Math.hypot(r2.solvedEnd[0], r2.solvedEnd[1], r2.solvedEnd[2]).toFixed(3));

  await app.close();
});
