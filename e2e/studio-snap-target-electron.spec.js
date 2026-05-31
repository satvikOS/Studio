import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-snap-target');

test('Studio — 3ds Max-style vertex snap target (slice 297)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioFindSnapTarget === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'snap demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'cube', pos: [0, 0, 0], scale: [1, 1, 1], color: '#fa5' },
        { kind: 'cube', pos: [1.0, 0, 0], scale: [1, 1, 1], color: '#5af' },
      ],
      expect: { bodies: 2, kinds: ['cube', 'cube'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);

  // Select cube A (at origin). Snap target should ignore A and find a vert of B.
  const uuids = await win.evaluate(() => {
    const cubes = [];
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cubes.push(o);
    });
    cubes.sort((a, b) => a.position.x - b.position.x);
    if (window.__studioSelectMesh) window.__studioSelectMesh(cubes[0]);
    return { a: cubes[0].uuid, b: cubes[1].uuid };
  });
  await win.waitForTimeout(300);

  const snap = await win.evaluate(() => window.__studioFindSnapTarget({
    fromPos: [0.6, 0, 0], kinds: ['vertex'], radius: 1.0,
  }));
  expect(snap).toBeTruthy();
  expect(snap.kind).toBe('vertex');
  expect(snap.meshUuid).toBe(uuids.b);
  expect(snap.distance).toBeLessThan(1.0);

  // No-result case: search far away with small radius.
  const miss = await win.evaluate(() => window.__studioFindSnapTarget({
    fromPos: [100, 100, 100], kinds: ['vertex'], radius: 0.1,
  }));
  expect(miss).toBeNull();

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 297: snap found vertex on other cube at distance', snap.distance.toFixed(3));

  await app.close();
});
