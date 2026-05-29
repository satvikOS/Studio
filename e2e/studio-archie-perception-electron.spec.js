import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — ARCHIE PERCEPTION STEP.
 *
 * Proves Archie can READ its own render and score it against a reference, then
 * feed that visual parity into the non-stop loop. Three claims:
 *
 *   1. The comparator DISCRIMINATES: rebuilding the same scene scores near-1
 *      against a golden capture; a visibly different scene scores clearly
 *      lower. (window.__archieCaptureRender + window.__archiePerceive)
 *
 *   2. The loop BLENDS visual parity: a goal whose plan carries a `reference`
 *      matching what it builds reaches 1:1 parity; the same plan judged against
 *      a reference of a DIFFERENT scene does NOT reach parity — the visual gate
 *      bites even though the body/kind critique is satisfied.
 *
 * Everything runs in-page on serializable data (data-URL strings), so the
 * golden render and curricula cross the Playwright boundary cleanly.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-archie-perception');

// A small scene Archie can build offline + a visibly different one.
const SCENE_A = {
  goal: 'beacon-A', expect: { bodies: 3, kinds: ['cylinder', 'sphere', 'cone'] },
  bodies: [
    { kind: 'cylinder', pos: [0, -0.02, 0], scale: [0.4, 3.0, 0.4], color: '#3a3a40' },
    { kind: 'sphere', pos: [0, 0.04, 0], scale: [0.9, 0.9, 0.9], color: '#ffe39a', emissive: 1.6 },
    { kind: 'cone', pos: [0, 0.062, 0], scale: [1.0, 0.6, 1.0], color: '#2b2b30' },
  ],
};
const SCENE_B = {
  goal: 'slab-B', expect: { bodies: 3, kinds: ['cube'] },
  bodies: [
    { kind: 'cube', pos: [-0.05, 0, 0], scale: [2.6, 0.5, 2.6], color: '#8a8a8a' },
    { kind: 'cube', pos: [0.04, 0.02, 0.03], scale: [1.8, 1.2, 0.6], color: '#cfcfcf' },
    { kind: 'cube', pos: [0.0, -0.03, -0.04], scale: [3.0, 0.3, 1.2], color: '#5a5a5a' },
  ],
};

test('Studio — Archie perceives its render vs a reference and gates parity on it', async () => {
  test.setTimeout(300000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 30 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__archieCaptureRender === 'function', null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__archiePerceive === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(600);

  // ── 1) Build scene A, lock a steady camera, capture a GOLDEN render ──
  // (execute() already frames-all; golden + rebuild use the IDENTICAL settle
  //  sequence so any difference is the scene, not the camera.)
  const golden = await win.evaluate(async (A) => {
    await window.__archieRun({ curriculum: [A], goals: [A.goal], maxGoals: 1 });
    window.__studioFrameAll && window.__studioFrameAll();
    window.__archdiscSetOrbitBase && window.__archdiscSetOrbitBase();
    window.__archdiscOrbitView && window.__archdiscOrbitView(28, 16, 1.15);
    await new Promise((r) => setTimeout(r, 250));
    return window.__archieCaptureRender();
  }, SCENE_A);
  expect(golden, 'captured a golden render').toMatch(/^data:image\/png/);
  await win.screenshot({ path: path.join(OUT, '01-golden-sceneA.png') });

  // Rebuild scene A under the SAME camera → should match the golden closely.
  const simA = await win.evaluate(async ({ A, ref }) => {
    await window.__archieRun({ curriculum: [A], goals: [A.goal], maxGoals: 1 });
    window.__studioFrameAll && window.__studioFrameAll();
    window.__archdiscSetOrbitBase && window.__archdiscSetOrbitBase();
    window.__archdiscOrbitView && window.__archdiscOrbitView(28, 16, 1.15);
    await new Promise((r) => setTimeout(r, 250));
    return window.__archiePerceive(ref);
  }, { A: SCENE_A, ref: golden });

  // Build the DIFFERENT scene B under the SAME camera → should match less.
  const simB = await win.evaluate(async ({ B, ref }) => {
    await window.__archieRun({ curriculum: [B], goals: [B.goal], maxGoals: 1 });
    window.__studioFrameAll && window.__studioFrameAll();
    window.__archdiscSetOrbitBase && window.__archdiscSetOrbitBase();
    window.__archdiscOrbitView && window.__archdiscOrbitView(28, 16, 1.15);
    await new Promise((r) => setTimeout(r, 250));
    return window.__archiePerceive(ref);
  }, { B: SCENE_B, ref: golden });
  await win.screenshot({ path: path.join(OUT, '02-sceneB-different.png') });

  // eslint-disable-next-line no-console
  console.log(`  perception: rebuild-A vs golden = ${simA.toFixed(3)}, sceneB vs golden = ${simB.toFixed(3)}`);
  fs.writeFileSync(path.join(OUT, 'perception-metrics.json'), JSON.stringify({ simA, simB, gap: simA - simB }, null, 2));
  expect(simA, 'rebuilding the same scene matches the golden closely').toBeGreaterThan(0.8);
  expect(simA - simB, 'a different scene is clearly less similar than the rebuild').toBeGreaterThan(0.2);

  // ── 2) The loop BLENDS visual parity into the critique ──
  // Same plan, two references: one matching what it builds (golden of A), one
  // of a different scene (golden of B). The matching ref reaches parity; the
  // mismatched ref does NOT, even though body/kind critique is satisfied.
  const goldenB = await win.evaluate(async (B) => {
    await window.__archieRun({ curriculum: [B], goals: [B.goal], maxGoals: 1 });
    window.__studioFrameAll && window.__studioFrameAll();
    window.__archdiscSetOrbitBase && window.__archdiscSetOrbitBase();
    window.__archdiscOrbitView && window.__archdiscOrbitView(28, 16, 1.15);
    await new Promise((r) => setTimeout(r, 250));
    return window.__archieCaptureRender();
  }, SCENE_B);

  // Plan builds A; reference IS A's golden, captured at the same view → the
  // loop orbits to plan.view before perceiving → high visual → blended parity.
  const matched = await win.evaluate(async ({ A, ref }) => {
    const goal = { ...A, goal: 'beacon-match', reference: ref, view: [28, 16, 1.15] };
    return window.__archieRun({ curriculum: [goal], goals: [goal.goal], maxGoals: 1, maxIterations: 3 });
  }, { A: SCENE_A, ref: golden });

  // PROOF: dump the exact frame the loop perceived + its reference, so the
  // loop-internal render can be eyeballed against the golden (they should be
  // framed identically — same scene, same pose, same size).
  const proof = await win.evaluate(() => ({ render: window.__archieLastRender, ref: window.__archieLastRef }));
  if (proof.render) fs.writeFileSync(path.join(OUT, '03-loop-render.png'), Buffer.from(proof.render.split(',')[1], 'base64'));
  if (proof.ref) fs.writeFileSync(path.join(OUT, '03-loop-ref.png'), Buffer.from(proof.ref.split(',')[1], 'base64'));

  // Plan builds A; reference is B's golden → same view, different scene → low
  // visual → the visual gate blocks parity even though structure is complete.
  const mismatched = await win.evaluate(async ({ A, refB }) => {
    const goal = { ...A, goal: 'beacon-mismatch', reference: refB, view: [28, 16, 1.15] };
    return window.__archieRun({ curriculum: [goal], goals: [goal.goal], maxGoals: 1, maxIterations: 3 });
  }, { A: SCENE_A, refB: goldenB });

  // eslint-disable-next-line no-console
  console.log(`  loop blend: matched parity=${matched.parityReached} score=${matched.log[0].score.toFixed(3)} | mismatch parity=${mismatched.parityReached} score=${mismatched.log[0].score.toFixed(3)}`);

  // Ground-truth diagnostics to disk (reporter buffering can swallow stdout).
  fs.writeFileSync(path.join(OUT, 'perception-metrics.json'), JSON.stringify({
    simA, simB, gap: simA - simB,
    matched: { parity: matched.parityReached, score: matched.log[0].score },
    mismatched: { parity: mismatched.parityReached, score: mismatched.log[0].score },
  }, null, 2));

  expect(matched.parityReached, 'matching reference reaches visual parity').toBe(1);
  expect(matched.log[0].score, 'matched blended score is high (visual ~1, structure complete)').toBeGreaterThan(0.85);
  expect(mismatched.parityReached, 'mismatched reference is gated out of parity by the visual step').toBe(0);
  expect(mismatched.log[0].score, 'mismatch is judged strictly worse than the match').toBeLessThan(matched.log[0].score);

  await app.close();
});
