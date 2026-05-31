import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-fillet-edges');

test('Studio — Plasticity/MoI fillet edges (slice 293)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioFilletEdges === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'fillet demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'cube', pos: [0, 0, 0], scale: [4, 4, 4], color: '#9bd' }],
      expect: { bodies: 1, kinds: ['cube'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  const uuid = await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
    return m ? m.uuid : null;
  });
  expect(uuid).toBeTruthy();
  await win.waitForTimeout(400);

  const before = await win.evaluate(({ u }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) m = o; });
    return { vertCount: m.geometry.attributes.position.count };
  }, { u: uuid });

  const res = await win.evaluate(({ u }) => window.__studioFilletEdges({
    meshUuid: u, radius: 0.04, threshold: Math.PI / 6,
  }), { u: uuid });
  expect(res).toBeTruthy();
  // A welded cube has 12 manifold edges, all at π/2 > π/6.
  expect(res.filletedEdges).toBe(12);
  expect(res.shiftedVerts).toBeGreaterThan(0);
  expect(res.radius).toBeCloseTo(0.04, 5);

  const after = await win.evaluate(({ u }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) m = o; });
    return {
      vertCount: m.geometry.attributes.position.count,
      counter: m.userData.archdiscStudioFilleted,
    };
  }, { u: uuid });
  // After welding, a BoxGeometry shrinks to 8 unique verts (down from 24).
  expect(after.vertCount).toBeLessThan(before.vertCount);
  expect(after.counter).toBe(1);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2000);

  // eslint-disable-next-line no-console
  console.log('  slice 293: fillet edges', res.filletedEdges, 'sharp, shifted', res.shiftedVerts, 'verts');

  await app.close();
});
