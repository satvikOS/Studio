import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — ARCHIE PERCEPTION-GUIDED CONVERGENCE (headed Electron, run BY Archie).
 *
 * The previous spec proved Archie can READ its render and GATE parity on it.
 * This one proves the perception score is a signal Archie actively OPTIMISES
 * against: given a reference image and a plan that starts visually wrong, the
 * non-stop loop sweeps the plan's declared structural variants, the visual
 * score climbs across iterations, and the loop converges on the variant that
 * matches the reference — reaching 1:1 parity without being told the answer.
 *
 * Target: a beacon whose bulb is too SMALL. The reference has the big bulb;
 * the plan declares scale variants [small, mid, big]; Archie must find "big".
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-archie-perception-convergence');

const POST = { kind: 'cylinder', pos: [0, -0.02, 0], scale: [0.45, 2.6, 0.45], color: '#33333a' };
// Reference bulb — the correct (big) size.
const BULB_BIG = { kind: 'sphere', pos: [0, 0.05, 0], scale: [1.35, 1.35, 1.35], color: '#ffe39a', emissive: 1.7 };
const REF_SCENE = { goal: 'beacon-ref', bodies: [POST, BULB_BIG], expect: { bodies: 2, kinds: ['cylinder', 'sphere'] } };

test('Studio — Archie iterates toward a reference using its perception score', async () => {
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
  await win.waitForTimeout(600);

  // ── Capture the reference (big-bulb beacon) at a fixed, framed pose ──
  const reference = await win.evaluate(async (R) => {
    await window.__archieRun({ curriculum: [R], goals: [R.goal], maxGoals: 1 });
    window.__studioFrameAll && window.__studioFrameAll();
    window.__archdiscSetOrbitBase && window.__archdiscSetOrbitBase();
    window.__archdiscOrbitView && window.__archdiscOrbitView(28, 16, 1.15);
    await new Promise((r) => setTimeout(r, 250));
    return window.__archieCaptureRender();
  }, REF_SCENE);
  expect(reference, 'captured a reference render').toMatch(/^data:image\/png/);
  await win.screenshot({ path: path.join(OUT, '01-reference-big-bulb.png') });

  // ── Hand Archie a plan that starts WRONG (tiny bulb) but declares the size
  //    variants. It must climb the perception score to the big-bulb variant. ──
  const conv = await win.evaluate(async ({ reference }) => {
    const goal = {
      goal: 'beacon-converge',
      bodies: [
        { kind: 'cylinder', pos: [0, -0.02, 0], scale: [0.45, 2.6, 0.45], color: '#33333a' },
        {
          kind: 'sphere', pos: [0, 0.05, 0], scale: [0.5, 0.5, 0.5], color: '#ffe39a', emissive: 1.7,
          // deterministic structural sweep: small -> mid -> big (the match)
          variants: [
            { scale: [0.5, 0.5, 0.5] },
            { scale: [0.9, 0.9, 0.9] },
            { scale: [1.35, 1.35, 1.35] },
          ],
        },
      ],
      expect: { bodies: 2, kinds: ['cylinder', 'sphere'] },
      reference,
      view: [28, 16, 1.15],
    };
    const events = [];
    const r = await window.__archieRun({
      curriculum: [goal], goals: [goal.goal], maxGoals: 1, maxIterations: 8,
      onEvent: (e) => { if (e.type === 'iteration') events.push({ it: e.iteration, visual: e.visual, score: e.score }); },
    });
    return { r, events, lastRender: window.__archieLastRender };
  }, { reference });

  // Persist the converged render + the iteration trace as proof.
  if (conv.lastRender) fs.writeFileSync(path.join(OUT, '02-archie-converged.png'), Buffer.from(conv.lastRender.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(OUT, 'convergence-trace.json'), JSON.stringify(conv, (k, v) => k === 'lastRender' ? undefined : v, 2));

  const visuals = conv.events.map((e) => e.visual).filter((v) => typeof v === 'number');
  // eslint-disable-next-line no-console
  console.log(`  convergence: ${visuals.length} iters, visual ${visuals.map((v) => v.toFixed(3)).join(' -> ')}, parity=${conv.r.parityReached}`);

  // ── Claims ──
  expect(visuals.length, 'Archie tried multiple variants (did not stop at the wrong one)').toBeGreaterThanOrEqual(3);
  const firstVisual = visuals[0];
  const bestVisual = Math.max(...visuals);
  expect(bestVisual - firstVisual, 'the perception score climbed as Archie searched').toBeGreaterThan(0.08);
  expect(conv.r.parityReached, 'Archie converged to 1:1 parity with the reference').toBe(1);

  await app.close();
});
