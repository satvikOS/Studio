import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — RIGID-BODY SIMULATION (headed Electron).
 *
 * Closes the Chaos / PhysX gap (Unreal Chaos / Unity PhysX / Blender Rigid Body
 * World / Houdini RBD). The old "physics" was a vertical-only gravity drop with
 * a single ground bounce — no inter-body collision. This verifies the real
 * solver: drop an UNSTABLE column of spheres, and pairwise impulse collision +
 * positional correction make them topple into a settled pile that
 *   (a) rests on the ground (no sinking / no floating),
 *   (b) does NOT interpenetrate (every pair stays >= 0.85*(r1+r2) apart),
 *   (c) SPREADS horizontally (collisions pushed the column out into a pile),
 *   (d) comes to rest (velocities settle to ~0 under friction).
 * Deterministic stepping (no rAF) makes the assertions reproducible.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-rigidbody-physics');
const GROUND_Y = -0.045;

test('Studio — rigid-body solver: an unstable column collides into a settled pile', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 25 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioPhysicsStep === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // ── add a stack of spheres via the real ribbon (modeling tab) ──
  for (let i = 0; i < 6; i++) { await win.locator('[data-studio-primitive="sphere"]').click(); await win.waitForTimeout(120); }

  // ── arrange them as an UNSTABLE near-touching column (deterministic offsets):
  //    bodies scaled up for a chunky, readable collapse; stacked so they begin
  //    almost in contact (little free-fall) and topple by collision, not scatter ──
  const setup = await win.evaluate(() => {
    const s = window.__archdiscScene; const arr = [];
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) arr.push(o); });
    arr.forEach((o) => { o.scale.set(2.6, 2.6, 2.6); if (o.geometry) o.geometry.computeBoundingSphere(); });
    const o0 = arr[0]; const r = o0.geometry.boundingSphere.radius * 2.6;
    const floor = -0.045 + r;
    arr.forEach((o, i) => { o.position.set((i - (arr.length - 1) / 2) * r * 0.18, floor + i * r * 2.04, 0); o.userData.studioVelocity = [0, 0, 0]; });
    return { count: arr.length, r };
  });
  expect(setup.count, 'six bodies in the column').toBeGreaterThanOrEqual(5);

  const spread = () => win.evaluate(() => {
    const s = window.__archdiscScene; const p = [];
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) p.push(o.position); });
    let mx = 0; for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) { const dx = p[i].x - p[j].x, dz = p[i].z - p[j].z; mx = Math.max(mx, Math.hypot(dx, dz)); } return mx;
  });
  const initialSpread = await spread();

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(12, 6, 1.5); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-unstable-column.png') });

  // ── deterministically advance the solver ~6 s (300 steps x 20 ms) ──
  const finalState = await win.evaluate(() => window.__studioPhysicsStep(300, 0.02));
  const r = setup.r;

  // (a) at least one body rests on the floor; none sank through / floats away
  const floorY = GROUND_Y + r;
  const ys = finalState.map((b) => b.pos[1]);
  const minY = Math.min(...ys);
  expect(Math.abs(minY - floorY), 'lowest body rests ON the ground (by its radius)').toBeLessThan(0.06);
  expect(Math.max(...ys), 'no body launched off into space').toBeLessThan(floorY + r * 6);

  // (b) NON-penetration — every pair stays apart (sphere-proxy collision works)
  let minGap = Infinity;
  for (let i = 0; i < finalState.length; i++) for (let j = i + 1; j < finalState.length; j++) {
    const a = finalState[i].pos, c = finalState[j].pos;
    const d = Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
    const want = finalState[i].radius + finalState[j].radius;
    minGap = Math.min(minGap, d / want);
  }
  expect(minGap, 'no pair interpenetrates (>=0.85 of summed radii)').toBeGreaterThan(0.85);

  // (c) the column SPREAD into a pile (inter-body collision pushed them out)
  const finalSpread = await spread();
  expect(finalSpread, 'pile is wider than the initial column').toBeGreaterThan(initialSpread + r);
  expect(finalSpread, 'pile spread to at least ~1.5 radii').toBeGreaterThan(r * 1.5);

  // (d) the sim SETTLED — velocities damped to ~rest by friction
  const maxVel = Math.max(...finalState.map((b) => Math.hypot(b.vel[0], b.vel[1], b.vel[2])));
  expect(maxVel, 'bodies came to rest (friction settled the pile)').toBeLessThan(0.2);

  // ── the rigid-body tool is integrated in the VFX/Sim ribbon ──
  await win.locator('[data-studio-discipline="vfx-sim"]').click();
  await expect(win.locator('[data-studio-ribbon-action="rigidbody-sim"]')).toBeVisible({ timeout: 8000 });

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(14, 7, 1.45); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '02-settled-pile.png') });

  // eslint-disable-next-line no-console
  console.log(`  rigid body: r=${r.toFixed(3)} bodies=${finalState.length}; spread ${initialSpread.toFixed(3)}->${finalSpread.toFixed(3)}; minGap=${minGap.toFixed(2)}x; minY=${minY.toFixed(3)} (floor ${floorY.toFixed(3)}); maxVel=${maxVel.toFixed(3)}`);

  await app.close();
});
