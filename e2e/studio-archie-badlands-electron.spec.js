import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — ARCHIE composes a BADLANDS hoodoo field (headed Electron).
 *
 * Builds on the single hoodoo: Archie now composes a complex multi-element
 * SCENE with horizontal layout — three eroded hoodoos of varying height on a
 * weathered mesa — proving it isn't limited to a single centred stack. Each
 * hoodoo reuses the proven embedded-cap recipe, uniformly scaled + X/Z-offset
 * so connectivity is preserved at any size. Fully sculpted (erode + weather).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-archie-badlands');

// A proven, connectivity-safe 4-mass hoodoo (cap embedded low into the column),
// uniformly scaled by s and placed at (x, z). Uniform scale keeps overlaps.
function hoodoo(x, z, s, tint) {
  const at = (px, py, pz) => [x + px * s, py * s, z + pz * s];
  const sc = (a, b, c) => [a * s, b * s, c * s];
  return [
    { kind: 'cylinder',    pos: at(0, -0.02, 0), scale: sc(2.4, 0.5, 2.4), color: tint[0], ops: ['sculpt-erode'] },
    { kind: 'icosahedron', pos: at(0, 0.0, 0),   scale: sc(1.7, 1.8, 1.7), color: tint[1], ops: ['sculpt-erode', 'sculpt-weather'] },
    { kind: 'icosahedron', pos: at(0, 0.032, 0), scale: sc(1.2, 1.6, 1.2), color: tint[2], ops: ['sculpt-erode', 'sculpt-weather'] },
    { kind: 'dodecahedron',pos: at(0, 0.05, 0),  scale: sc(1.6, 0.8, 1.6), color: tint[3], ops: ['sculpt-weather'] }, // embedded cap
  ];
}

const T1 = ['#6f655a', '#73695c', '#6d6256', '#80766a'];
const T2 = ['#6b6154', '#776c5e', '#6f6458', '#837868'];
const T3 = ['#6a6053', '#71675a', '#6c6155', '#7e7466'];

const BADLANDS = {
  goal: 'badlands hoodoo field',
  bodies: [
    // small, deeply eroded rocky base — kept compact so it doesn't read as a
    // big flat (cool-fill-lit) disc; mostly tucked under the hoodoo footings
    { kind: 'cylinder', pos: [0, -0.055, 0], scale: [4.4, 1.0, 4.4], color: '#5f564c', ops: ['sculpt-erode'] },
    ...hoodoo(-0.05, 0.008, 1.1, T1),   // mid
    ...hoodoo(0.01, -0.015, 1.45, T2),  // tall
    ...hoodoo(0.058, 0.02, 0.8, T3),    // short
  ],
  expect: { bodies: 13, kinds: ['cylinder', 'icosahedron', 'dodecahedron'] },
};

test('Studio — Archie composes a badlands hoodoo field', async () => {
  test.setTimeout(420000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 20 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(600);

  const built = await win.evaluate(async (B) => {
    const r = await window.__archieRun({ curriculum: [B], goals: [B.goal], maxGoals: 1 });
    window.__studioFrameAll && window.__studioFrameAll();
    window.__archdiscSetOrbitBase && window.__archdiscSetOrbitBase();
    window.__archdiscOrbitView && window.__archdiscOrbitView(34, 7, 1.12);
    await new Promise((res) => setTimeout(res, 320));
    const scene = window.__archdiscScene; let bodies = 0;
    scene && scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) bodies++; });
    return { r, bodies, render: window.__archieCaptureRender() };
  }, BADLANDS);

  expect(built.r.completed).toBe(1);
  expect(built.bodies, 'all 13 bodies present (mesa + 3 hoodoos)').toBe(13);
  if (built.render) fs.writeFileSync(path.join(OUT, '01-badlands.png'), Buffer.from(built.render.split(',')[1], 'base64'));
  await win.screenshot({ path: path.join(OUT, '01-badlands-app.png') });

  await app.close();
});
