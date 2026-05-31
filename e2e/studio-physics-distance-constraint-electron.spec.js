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

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'distance constraint demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'cube', pos: [-1, 0.5, 0], scale: [1, 1, 1], color: '#f5a' },
        { kind: 'cube', pos: [ 1, 0.5, 0], scale: [1, 1, 1], color: '#5af' },
      ],
      expect: { bodies: 2, kinds: ['cube', 'cube'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(800);

  // Rename them so the constraint can resolve them by name.
  const names = await win.evaluate(() => {
    const cubes = [];
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cubes.push(o);
    });
    cubes.sort((a, b) => a.position.x - b.position.x);
    cubes[0].name = 'BodyA'; cubes[1].name = 'BodyB';
    return [cubes[0].name, cubes[1].name];
  });
  expect(names).toEqual(['BodyA', 'BodyB']);

  const before = await win.evaluate(() => window.__studioPhysicsListConstraints().length);
  expect(before).toBe(0);

  const add = await win.evaluate(() => window.__studioPhysicsAddConstraint({
    kind: 'distance', bodyA: 'BodyA', bodyB: 'BodyB',
    anchorA: [0, 0, 0], anchorB: [0, 0, 0], distance: 1.5, iterations: 8,
  }));
  expect(add).toBeTruthy();
  expect(add.id).toContain('c_');
  expect(add.distance).toBeCloseTo(1.5, 5);

  // Manually invoke physicsStep so the constraint projects.
  await win.evaluate(() => window.__studioPhysicsStep(20, 0.016));
  await win.waitForTimeout(300);

  const probe = await win.evaluate(() => {
    let a = null, b = null;
    window.__archdiscScene.traverse((o) => { if (o.name === 'BodyA') a = o; if (o.name === 'BodyB') b = o; });
    const d = a.position.distanceTo(b.position);
    return { d, posA: [a.position.x, a.position.y, a.position.z], posB: [b.position.x, b.position.y, b.position.z] };
  });
  // Distance should have converged to 1.5 within tolerance.
  expect(Math.abs(probe.d - 1.5)).toBeLessThan(0.1);

  // Remove constraint.
  const list = await win.evaluate(() => window.__studioPhysicsListConstraints());
  expect(list.length).toBe(1);
  const removed = await win.evaluate(({ id }) => window.__studioPhysicsRemoveConstraint(id), { id: add.id });
  expect(removed).toBe(true);
  const after = await win.evaluate(() => window.__studioPhysicsListConstraints().length);
  expect(after).toBe(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 300: distance constraint converged to', probe.d.toFixed(3), '(target 1.5)');

  await app.close();
});
