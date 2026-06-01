import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-animphys');

test('Studio V3 — animation + physics families (slice 408)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioSetFrame === 'function', null, { timeout: 15000 });

  // Spawn + select cube.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    vp.transformControls.attach(cube);
  });

  // ─── Frame state ─────────────────────────────────────────────────────
  expect(await win.evaluate(() => window.__studioGetFrame())).toBe(0);
  expect((await win.evaluate(() => window.__studioSetFrame(12))).ok).toBe(true);
  expect(await win.evaluate(() => window.__studioGetFrame())).toBe(12);
  expect((await win.evaluate(() => window.__studioSetFrame(-1))).ok).toBe(false);

  // ─── Animating toggle ────────────────────────────────────────────────
  const a1 = await win.evaluate(() => window.__studioToggleAnimating());
  expect(a1.animating).toBe(true);
  const a2 = await win.evaluate(() => window.__studioToggleAnimating());
  expect(a2.animating).toBe(false);

  // ─── Keyframes ───────────────────────────────────────────────────────
  // Set pos at frame 0, move to (0.1, 0, 0) at frame 24, eval at frame 12.
  // Note: setFrame evaluates existing kfs and rewrites positions, so we
  // MUST setFrame first and reposition AFTER (otherwise our move gets
  // clobbered when setFrame runs).
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    window.__studioSetFrame(0);
    m.position.set(0, 0, 0); m.updateMatrixWorld(true);
    window.__studioInsertKeyframeAt(0);
    window.__studioSetFrame(24);
    m.position.set(0.1, 0, 0); m.updateMatrixWorld(true);
    window.__studioInsertKeyframeAt(24);
  });
  const kfs = await win.evaluate(() => window.__studioGetKeyframes());
  expect(kfs.ok).toBe(true);
  expect(kfs.keyframes.length).toBe(2);
  // Eval at frame 12 → x should be ~0.05.
  await win.evaluate(() => window.__studioSetFrame(12));
  const posAt12 = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return [m.position.x, m.position.y, m.position.z];
  });
  expect(posAt12[0]).toBeCloseTo(0.05, 5);

  // ─── BP / BT / Niagara stubs ─────────────────────────────────────────
  expect((await win.evaluate(() => window.__studioAnimBPSet('running'))).state).toBe('running');
  expect((await win.evaluate(() => window.__studioAnimBPStep())).ok).toBe(true);
  expect((await win.evaluate(() => window.__studioBTTick({ task: 'patrol' }))).ok).toBe(true);
  expect((await win.evaluate(() => window.__studioRunBlueprint('jump'))).blueprint).toBe('jump');
  const ns = await win.evaluate(() => window.__studioNiagaraStep(0.016));
  expect(ns.ok).toBe(true);

  // ─── Physics ─────────────────────────────────────────────────────────
  // Enable physics on a fresh cube; set it above ground; step several
  // times; should fall and bounce.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    let cube = null;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o;
    });
    cube.position.set(0, 1, 0); cube.updateMatrixWorld(true);
    window.__studioSelectMesh(cube);
  });
  expect((await win.evaluate(() => window.__studioPhysicsEnable())).ok).toBe(true);
  // 60 steps × 0.016 dt ≈ 1 s. Cube should have fallen and hit floor at y=0.
  await win.evaluate(() => { for (let i = 0; i < 60; i++) window.__studioPhysicsStep(0.016); });
  const state = await win.evaluate(() => window.__studioPhysicsState());
  expect(state.length).toBeGreaterThanOrEqual(1);
  const physCube = state.find((s) => s.pos[1] < 0.5);
  expect(physCube).toBeTruthy();
  // Reset puts it back.
  await win.evaluate(() => window.__studioResetPhysics());
  const resetState = await win.evaluate(() => window.__studioPhysicsState());
  const after = resetState.find((s) => s.pos[1] > 0.5);
  expect(after).toBeTruthy();

  // ─── Constraints ─────────────────────────────────────────────────────
  // Spawn a second cube, mark physics, add a distance constraint.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const constraint = await win.evaluate(() => {
    const cubes = [];
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cubes.push(o);
    });
    const [a, b] = cubes.slice(-2);
    window.__studioSelectMesh(b);
    window.__studioPhysicsEnable();
    return window.__studioPhysicsAddConstraint(a.uuid, b.uuid, 0.1);
  });
  expect(constraint.ok).toBe(true);
  expect((await win.evaluate(() => window.__studioPhysicsListConstraints())).length).toBeGreaterThan(0);
  const removed = await win.evaluate((id) => window.__studioPhysicsRemoveConstraint(id), constraint.id);
  expect(removed.ok).toBe(true);
  expect((await win.evaluate(() => window.__studioPhysicsClearConstraints())).ok).toBe(true);

  await win.screenshot({ path: path.join(OUT, '00-after-animphys.png') });

  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log('  slice 408: anim frame/keyframes + physics step/state/constraints all green');

  await app.close();
});
