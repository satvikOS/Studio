import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-physics-distance-constraint');

test('Studio — UE/PhysX distance constraint (slice 300)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioPhysicsAddConstraint === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Spawn two cubes via the ribbon (reliable: ArchieRun's body.pos field is
  // currently dropped by ArchieExtractor.synthesizeStepArrayFromPlan).
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);

  // Manually position both so distances are exactly known, regardless of
  // primitive-stack grid placement.
  const setup = await win.evaluate(() => {
    const cubes = [];
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cubes.push(o);
    });
    if (cubes.length < 2) return { ok: false, error: 'expected >= 2 cubes, got ' + cubes.length };
    cubes[0].position.set(-1, 0.5, 0); cubes[0].name = 'BodyA';
    cubes[1].position.set( 1, 0.5, 0); cubes[1].name = 'BodyB';
    cubes[0].userData.studioVelocity = [0, 0, 0];
    cubes[1].userData.studioVelocity = [0, 0, 0];
    return { ok: true, count: cubes.length };
  });
  expect(setup.ok).toBe(true);

  // Confirm starting distance is 2.
  const start = await win.evaluate(() => {
    let a = null, b = null;
    window.__archdiscScene.traverse((o) => { if (o.name === 'BodyA') a = o; if (o.name === 'BodyB') b = o; });
    return a.position.distanceTo(b.position);
  });
  expect(start).toBeCloseTo(2.0, 5);

  // Add constraint targeting distance 1.5.
  const add = await win.evaluate(() => window.__studioPhysicsAddConstraint({
    kind: 'distance', bodyA: 'BodyA', bodyB: 'BodyB',
    anchorA: [0, 0, 0], anchorB: [0, 0, 0], distance: 1.5, iterations: 10,
  }));
  expect(add).toBeTruthy();
  expect(add.distance).toBeCloseTo(1.5, 5);

  // Run physics steps — constraint should converge.
  await win.evaluate(() => window.__studioPhysicsStep(40, 0.016));
  await win.waitForTimeout(300);

  const finalDist = await win.evaluate(() => {
    let a = null, b = null;
    window.__archdiscScene.traverse((o) => { if (o.name === 'BodyA') a = o; if (o.name === 'BodyB') b = o; });
    return a.position.distanceTo(b.position);
  });
  expect(Math.abs(finalDist - 1.5)).toBeLessThan(0.2);

  // List + remove.
  const list = await win.evaluate(() => window.__studioPhysicsListConstraints());
  expect(list.length).toBe(1);
  const removed = await win.evaluate(({ id }) => window.__studioPhysicsRemoveConstraint(id), { id: add.id });
  expect(removed).toBe(true);
  const after = await win.evaluate(() => window.__studioPhysicsListConstraints().length);
  expect(after).toBe(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 300: distance constraint converged to', finalDist.toFixed(3), '(target 1.5, start 2.0)');

  await app.close();
});
