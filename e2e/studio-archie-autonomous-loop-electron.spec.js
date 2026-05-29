import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — ARCHIE AUTONOMOUS LOOP (tests done by in-house Archie).
 *
 * This spec writes almost no build code. It boots Studio and hands the work
 * to Archie via window.__archieRun (the loop wired onto the AI scaffold in
 * frontend/src/ai/ArchieLoop.js). Archie plans -> builds via the real build
 * functions -> reads the scene back -> self-critiques -> iterates NON-STOP
 * until 1:1-or-better parity -> banks a reusable skill. The test only asserts
 * that Archie behaved autonomously and reached parity, and captures what it
 * built.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-archie-autonomous-loop');

test('Studio — Archie builds the curriculum autonomously to parity', async () => {
  test.setTimeout(420000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 30 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(600);

  // Archie's curriculum (self-directed goals it knows offline).
  const goals = await win.evaluate(() => window.__archieEngine.DEFAULT_CURRICULUM.map((g) => g.goal));
  expect(goals.length).toBeGreaterThanOrEqual(3);

  // ── Archie builds each goal on its own, to parity; we just watch + shoot ──
  for (const goal of goals) {
    const r = await win.evaluate((g) => window.__archieRun({ goals: [g], maxGoals: 1 }), goal);
    expect(r.completed, `built ${goal}`).toBe(1);
    expect(r.parityReached, `parity on ${goal}`).toBe(1);     // 1:1 or better
    expect(r.log[0].score).toBeGreaterThanOrEqual(1.0);
    await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
    await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(32, 18, 1.15));
    await win.waitForTimeout(300);
    await win.screenshot({ path: path.join(OUT, `01-archie-${goal.replace(/\s+/g, '-')}.png`), fullPage: false });
  }

  // ── NON-STOP self-direction: seed ONE goal, let Archie keep itself busy ──
  const nonstop = await win.evaluate(() =>
    window.__archieRun({ goals: ['stone cairn'], maxGoals: 3, selfDirect: true }));
  expect(nonstop.completed, 'self-directed non-stop completed 3 from 1 seed').toBe(3);
  expect(nonstop.parityReached).toBe(3);

  // ── SELF-IMPROVEMENT: the skill store persists; re-running a known goal
  //    reuses/improves the banked skill rather than starting from scratch. ──
  const again = await win.evaluate(() =>
    window.__archieRun({ goals: ['ringed monolith'], maxGoals: 1 }));
  expect(again.reuses + again.improvements, 'reused or improved a banked skill').toBeGreaterThanOrEqual(1);

  // ── Final state: Archie has banked a skill per curriculum goal ──
  const skills = await win.evaluate(() => window.__archieEngine.skillStore.list());
  expect(skills.length).toBeGreaterThanOrEqual(3);
  for (const s of skills) {
    expect(s.score).toBeGreaterThanOrEqual(1.0); // every banked skill is at parity
    expect(s.uses).toBeGreaterThanOrEqual(1);
  }

  // eslint-disable-next-line no-console
  console.log(`  archie: built ${goals.length} goals to parity, banked ${skills.length} skills, non-stop self-direction OK`);

  await app.close();
});
