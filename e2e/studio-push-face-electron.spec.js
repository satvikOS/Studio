import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-push-face');

test('Studio — SketchUp Push/Pull single-face extrude (slice 283)', async () => {
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
  await win.waitForTimeout(1500);

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'push face demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'cube', pos: [0, 0, 0], scale: [4, 4, 4], color: '#9bd' }],
      expect: { bodies: 1, kinds: ['cube'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(400);

  const before = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    const a = 0, b = 1, c = 2;
    return {
      uuid: m.uuid,
      a: [p.getX(a), p.getY(a), p.getZ(a)],
      b: [p.getX(b), p.getY(b), p.getZ(b)],
      c: [p.getX(c), p.getY(c), p.getZ(c)],
      // capture an untouched far vert too
      far: [p.getX(p.count - 1), p.getY(p.count - 1), p.getZ(p.count - 1)],
    };
  });

  const res = await win.evaluate(({ uuid }) => window.__studioPushFace(uuid, 0, 0.05), { uuid: before.uuid });
  expect(res).toBeTruthy();
  expect(res.distance).toBeCloseTo(0.05, 5);
  const nx = res.normal[0], ny = res.normal[1], nz = res.normal[2];

  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const p = m.geometry.attributes.position;
    return {
      a: [p.getX(0), p.getY(0), p.getZ(0)],
      b: [p.getX(1), p.getY(1), p.getZ(1)],
      c: [p.getX(2), p.getY(2), p.getZ(2)],
      far: [p.getX(p.count - 1), p.getY(p.count - 1), p.getZ(p.count - 1)],
      counter: m.userData.archdiscStudioFacePushed,
    };
  });
  expect(after.counter).toBe(1);
  // The 3 face verts each moved exactly normal * 0.05
  expect(after.a[0] - before.a[0]).toBeCloseTo(nx * 0.05, 5);
  expect(after.a[1] - before.a[1]).toBeCloseTo(ny * 0.05, 5);
  expect(after.a[2] - before.a[2]).toBeCloseTo(nz * 0.05, 5);
  expect(after.b[0] - before.b[0]).toBeCloseTo(nx * 0.05, 5);
  expect(after.c[2] - before.c[2]).toBeCloseTo(nz * 0.05, 5);
  // Far vertex unchanged (BoxGeometry is non-indexed → only face moves).
  expect(after.far[0]).toBeCloseTo(before.far[0], 5);
  expect(after.far[1]).toBeCloseTo(before.far[1], 5);
  expect(after.far[2]).toBeCloseTo(before.far[2], 5);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 283: push-face moved 3 verts along normal=', res.normal, 'distance=', res.distance);

  await app.close();
});
