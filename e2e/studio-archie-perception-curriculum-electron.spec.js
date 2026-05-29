import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — ARCHIE PERCEPTION ACROSS THE REAL CURRICULUM (headed Electron, run BY Archie).
 *
 * Proves the perception step works on Archie's ACTUAL sculpted, multi-body
 * curriculum models (stone cairn / ringed monolith / lantern post) — not a toy
 * beacon. For every model Archie:
 *   - builds it and captures a self-reference at a fixed framed pose,
 * then we score a full similarity MATRIX: every model's faithful rebuild vs
 * every model's reference. The diagonal (rebuild vs its OWN reference) must be
 * at/above visual parity and must be the row maximum — i.e. Archie recognises a
 * faithful rebuild of each real model and tells the three apart. Finally one
 * goal is run through the non-stop loop with its self-reference to confirm it
 * reaches visual parity end-to-end.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-archie-perception-curriculum');
const VIEW = [28, 16, 1.15];
const PARITY = 0.82;

test('Studio — Archie perceives faithful rebuilds of its real curriculum models', async () => {
  test.setTimeout(420000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 25 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__archiePerceive === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(600);

  const goals = await win.evaluate(() => window.__archieEngine.DEFAULT_CURRICULUM.map((g) => g.goal));
  expect(goals.length).toBeGreaterThanOrEqual(3);

  // Build each model at the fixed pose and capture a self-reference.
  const refs = {};
  for (const g of goals) {
    refs[g] = await win.evaluate(async ({ goal, view }) => {
      const cur = window.__archieEngine.DEFAULT_CURRICULUM.find((x) => x.goal === goal);
      await window.__archieRun({ curriculum: [cur], goals: [goal], maxGoals: 1 });
      window.__studioFrameAll && window.__studioFrameAll();
      window.__archdiscSetOrbitBase && window.__archdiscSetOrbitBase();
      window.__archdiscOrbitView && window.__archdiscOrbitView(view[0], view[1], view[2]);
      await new Promise((r) => setTimeout(r, 260));
      return window.__archieCaptureRender();
    }, { goal: g, view: VIEW });
    expect(refs[g], `reference for ${g}`).toMatch(/^data:image\/png/);
    await win.screenshot({ path: path.join(OUT, `ref-${g.replace(/\s+/g, '-')}.png`) });
  }

  // Similarity matrix: rebuild model X, score its render vs every reference Y.
  const matrix = {};
  for (const x of goals) {
    matrix[x] = await win.evaluate(async ({ goal, view, refs }) => {
      const cur = window.__archieEngine.DEFAULT_CURRICULUM.find((g) => g.goal === goal);
      await window.__archieRun({ curriculum: [cur], goals: [goal], maxGoals: 1 });
      window.__studioFrameAll && window.__studioFrameAll();
      window.__archdiscSetOrbitBase && window.__archdiscSetOrbitBase();
      window.__archdiscOrbitView && window.__archdiscOrbitView(view[0], view[1], view[2]);
      await new Promise((r) => setTimeout(r, 260));
      const row = {};
      for (const y of Object.keys(refs)) row[y] = await window.__archiePerceive(refs[y]); // current render (x) vs ref y
      return row;
    }, { goal: x, view: VIEW, refs });
  }

  fs.writeFileSync(path.join(OUT, 'similarity-matrix.json'), JSON.stringify(matrix, null, 2));
  // eslint-disable-next-line no-console
  console.log('  curriculum similarity matrix:');
  for (const x of goals) {
    // eslint-disable-next-line no-console
    console.log(`    ${x.padEnd(16)} ${goals.map((y) => `${y.split(' ')[0]}=${matrix[x][y].toFixed(3)}`).join('  ')}`);
  }

  // Claims: each faithful rebuild is recognised (diagonal >= parity) and is the
  // best match in its row by a clear margin (Archie tells the models apart).
  for (const x of goals) {
    const own = matrix[x][x];
    const others = goals.filter((y) => y !== x).map((y) => matrix[x][y]);
    expect(own, `${x} rebuild recognised vs its own reference`).toBeGreaterThanOrEqual(PARITY);
    expect(own - Math.max(...others), `${x} matches itself better than the other models`).toBeGreaterThan(0.05);
  }

  // End-to-end: run one model through the non-stop loop with its self-reference.
  const e2e = await win.evaluate(async ({ goal, ref, view }) => {
    const cur = window.__archieEngine.DEFAULT_CURRICULUM.find((g) => g.goal === goal);
    return window.__archieRun({
      curriculum: [{ ...cur, goal: `${goal}-perceived`, reference: ref, view }],
      goals: [`${goal}-perceived`], maxGoals: 1, maxIterations: 4,
    });
  }, { goal: goals[0], ref: refs[goals[0]], view: VIEW });
  expect(e2e.parityReached, `${goals[0]} reaches visual parity through the loop`).toBe(1);

  await app.close();
});
