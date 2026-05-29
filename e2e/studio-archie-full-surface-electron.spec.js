import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 184: AUTONOMOUS LOOP REACHES THE FULL STUDIO SURFACE.
 *
 * Closes the integration gap that slices 1-183 built on top of: the
 * autonomous loop's executor only knew 5 ops (sculpt-erode/weather/
 * clay/scrape, subdivide-selected). The new ToolRegistry catalogues
 * every ribbon action / primitive / property knob / __studio* entry
 * point, and the Archie executor now dispatches them all through one
 * universal path. A recipe can mix primitives, modifiers, sculpt
 * ops, material knobs, lights, and post-process filters — and the
 * loop runs them end-to-end with no Mech-era CAD references.
 *
 * The spec proves three things:
 *   (1) the registry covers all 8 Studio disciplines (no aviation /
 *       turbofan / FEA leftover entries),
 *   (2) Archie's executor can build a multi-discipline recipe to parity
 *       (primitive + sculpt op + material + light + comp filter), and
 *   (3) the scene actually carries the expected primitive kinds, op
 *       stamps, and a Studio light.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-archie-full-surface');

test('Studio — Archie reaches the full Studio surface end-to-end', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 30,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.waitForFunction(() => Array.isArray(window.__archieEngine && window.__archieEngine.TOOL_REGISTRY), null, { timeout: 30000 });
  await win.waitForTimeout(400);

  // ── (1) Registry shape ─────────────────────────────────────────────
  const summary = await win.evaluate(() => {
    const reg = window.__archieEngine.TOOL_REGISTRY;
    const byD = {}, byK = {};
    for (const t of reg) {
      byD[t.discipline] = (byD[t.discipline] || 0) + 1;
      byK[t.kind] = (byK[t.kind] || 0) + 1;
    }
    return { total: reg.length, byD, byK, sample: reg.slice(0, 5).map((t) => t.id) };
  });
  // eslint-disable-next-line no-console
  console.log('  registry summary:', JSON.stringify(summary));
  expect(summary.total, 'registry covers a large Studio surface').toBeGreaterThanOrEqual(220);
  for (const d of ['modeling', 'sculpting', 'uv-texture', 'rigging',
                   'animation', 'vfx-sim', 'rendering', 'compositing']) {
    expect(summary.byD[d], `discipline ${d} populated`).toBeGreaterThan(0);
  }
  expect(summary.byK['primitive'], 'all 20 primitives').toBeGreaterThanOrEqual(20);
  expect(summary.byK['ribbon-action'], '180+ ribbon actions').toBeGreaterThanOrEqual(180);

  // No Mech leftovers (Brayton/turbofan/FEA/Goodman/etc.)
  const mechLeak = await win.evaluate(() => {
    const reg = window.__archieEngine.TOOL_REGISTRY;
    const bad = ['Brayton Cycle', 'Mission', 'Linear Static FEA', 'Modal Analysis',
                 'Rotordynamics', 'Gear Mesh', 'Shaft Sizing', 'Blade Cooling',
                 'Compressor Stage', 'Turbine Stage', 'Combustor', 'Nozzle',
                 'Slice Preview', 'Export STEP', 'Standard 3 View'];
    return reg.filter((t) => bad.includes(t.id)).map((t) => t.id);
  });
  expect(mechLeak, 'no Mech-era tools survived the scrub').toEqual([]);

  await win.screenshot({ path: path.join(OUT, '00-registry-loaded.png') });

  // ── (2) Multi-discipline recipe via __archieRun ────────────────────
  // Custom curriculum that exercises modeling + sculpting + material +
  // rendering (lights) + compositing in one build.
  const recipe = {
    goal: 'studio surface sweep',
    scene: {
      discipline: 'rendering',
      engine: 'engine-eevee',
      world: 'world-solid',
      lights: [
        { type: 'light-point', color: '#ffd9a0', intensity: 0.18 },
        { type: 'light-sun',   color: '#ffffff', intensity: 0.20 },
      ],
      comp: ['comp-bloom', 'pp-tone-map'],
    },
    bodies: [
      { kind: 'icosahedron', pos: [-0.06, 0, 0], scale: [1.4, 1.0, 1.4],
        color: '#7a6e60',
        material: { metalness: 0.05, roughness: 0.85 },
        ops: ['sculpt-erode', 'sculpt-weather'] },
      { kind: 'teapot', pos: [0.06, 0, 0], scale: [1.0, 1.0, 1.0],
        color: '#bfa14a',
        material: { metalness: 0.9, roughness: 0.25 } },
      { kind: 'plane', pos: [0, -0.04, 0], scale: [3.5, 0.01, 3.5],
        color: '#2a2a2a' },
    ],
    expect: { bodies: 3, kinds: ['icosahedron', 'plane', 'teapot'] },
  };

  const result = await win.evaluate((r) => {
    // Skill store starts fresh — Archie will plan this recipe directly.
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  }, recipe);
  // eslint-disable-next-line no-console
  console.log('  archie result:', JSON.stringify(result));
  expect(result.completed, 'one goal completed').toBe(1);
  expect(result.parityReached, 'goal hit parity').toBe(1);

  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(28, 18, 1.25));
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-multi-discipline-build.png') });

  // ── (3) Scene actually carries the expected stamps ─────────────────
  const state = await win.evaluate(() => {
    const scene = window.__archdiscScene;
    const kinds = new Set();
    const ops = {};
    let bodies = 0, lights = 0;
    scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        bodies++;
        const k = String(o.userData.archdiscStudioPrimitiveKind || '').replace('-array', '');
        if (k) kinds.add(k);
        for (const [key, v] of Object.entries(o.userData)) {
          if (key.startsWith('archdiscStudio') && typeof v === 'number' && v > 0
              && key !== 'archdiscStudioPrimitive') {
            ops[key] = (ops[key] || 0) + v;
          }
        }
      }
      if (o.userData && o.userData.archdiscStudioLight) lights++;
    });
    return { bodies, kinds: [...kinds].sort(), ops, lights };
  });
  // eslint-disable-next-line no-console
  console.log('  scene state:', JSON.stringify(state));
  expect(state.bodies, 'three bodies in the scene').toBe(3);
  expect(state.kinds).toEqual(['icosahedron', 'plane', 'teapot']);
  // Sculpt ops applied via the universal dispatcher leave op-stamp counters.
  const stampSum = Object.values(state.ops).reduce((s, v) => s + v, 0);
  expect(stampSum, 'sculpt ops left stamps on the icosahedron').toBeGreaterThan(0);
  expect(state.lights, 'at least one Studio light landed').toBeGreaterThan(0);

  // eslint-disable-next-line no-console
  console.log('  slice 184: registry total=%d, build OK across %d disciplines',
              summary.total, Object.keys(summary.byD).length);

  await app.close();
});
