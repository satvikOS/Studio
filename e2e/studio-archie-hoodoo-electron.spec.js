import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — ARCHIE builds a weathered HOODOO rock spire (headed Electron).
 *
 * A complex, fully-sculpted natural model (not stacked primitives reading as
 * primitives): a tapering stack of heavily eroded + weathered rock masses with
 * a wider caprock, the classic hoodoo silhouette. Erosion/weathering is what
 * sells it as rock, so every mass carries sculpt-erode + sculpt-weather. Built
 * by Archie via its data-plan executor; framed once, whole-part-in-view.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-archie-hoodoo');

// Tapering eroded spire + caprock. Units: PRIMITIVE_SIZE=0.03m; scale multiplies.
const HOODOO = {
  goal: 'weathered hoodoo',
  // Tightly overlapping masses; erosion (bias < 0) shrinks each mass inward, so
  // the caprock is embedded LOW into the top mass to avoid a floating gap.
  bodies: [
    { kind: 'cylinder',    pos: [0, -0.02, 0],  scale: [2.9, 0.5, 2.9],  color: '#6f655a', ops: ['sculpt-erode'] },           // footing
    { kind: 'icosahedron', pos: [0,  0.0, 0],   scale: [2.0, 1.9, 2.0],  color: '#73695c', ops: ['sculpt-erode', 'sculpt-weather'] },
    { kind: 'icosahedron', pos: [0,  0.03, 0],  scale: [1.7, 1.7, 1.7],  color: '#6d6256', ops: ['sculpt-erode', 'sculpt-weather'] },
    { kind: 'icosahedron', pos: [0,  0.055, 0], scale: [1.4, 1.6, 1.4],  color: '#776c5e', ops: ['sculpt-erode', 'sculpt-weather'] },
    { kind: 'icosahedron', pos: [0,  0.078, 0], scale: [1.15, 1.6, 1.15], color: '#6b6154', ops: ['sculpt-erode', 'sculpt-weather'] },
    { kind: 'dodecahedron',pos: [0,  0.086, 0], scale: [1.9, 0.85, 1.9], color: '#80766a', ops: ['sculpt-weather'] },          // caprock, embedded
  ],
  expect: { bodies: 6, kinds: ['cylinder', 'icosahedron', 'dodecahedron'] },
};

test('Studio — Archie builds a weathered hoodoo rock spire', async () => {
  test.setTimeout(360000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(600);

  // Build it and capture a reference at one good whole-part framing.
  const reference = await win.evaluate(async (H) => {
    await window.__archieRun({ curriculum: [H], goals: [H.goal], maxGoals: 1 });
    window.__studioFrameAll && window.__studioFrameAll();
    window.__archdiscSetOrbitBase && window.__archdiscSetOrbitBase();
    window.__archdiscOrbitView && window.__archdiscOrbitView(38, 10, 1.18);
    await new Promise((res) => setTimeout(res, 300));
    return window.__archieCaptureRender();
  }, HOODOO);
  expect(reference, 'captured the hoodoo').toMatch(/^data:image\/png/);
  await win.screenshot({ path: path.join(OUT, '01-hoodoo.png') });

  // Perception self-recognition: Archie rebuilds the (sculpted, 6-body) hoodoo
  // and scores its render against the reference — perception works on a complex
  // weathered model, not just a toy.
  const perceived = await win.evaluate(async ({ H, ref }) => {
    const events = [];
    const r = await window.__archieRun({
      curriculum: [{ ...H, goal: 'weathered hoodoo-perceived', reference: ref, view: [38, 10, 1.18] }],
      goals: ['weathered hoodoo-perceived'], maxGoals: 1, maxIterations: 3,
      onEvent: (e) => { if (e.type === 'iteration') events.push({ it: e.iteration, visual: e.visual }); },
    });
    return { r, events, lastRender: window.__archieLastRender };
  }, { H: HOODOO, ref: reference });

  if (perceived.lastRender) fs.writeFileSync(path.join(OUT, '02-rebuild.png'), Buffer.from(perceived.lastRender.split(',')[1], 'base64'));
  const selfVisual = Math.max(...perceived.events.map((e) => e.visual).filter((v) => typeof v === 'number'));
  // eslint-disable-next-line no-console
  console.log(`  hoodoo self-recognition visual=${selfVisual.toFixed(3)} parity=${perceived.r.parityReached}`);

  expect(perceived.r.completed, 'Archie completed the hoodoo goal').toBe(1);
  // A faithful rebuild must look clearly like the reference (well above the
  // cross-model discrimination floor); exact 1:1 isn't required for a high-
  // detail eroded surface where sub-pixel AA on 800+ verts costs a little.
  expect(selfVisual, 'the rebuilt hoodoo clearly matches its reference').toBeGreaterThan(0.7);

  await app.close();
});
