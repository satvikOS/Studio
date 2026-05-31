import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-mash-distribute');

test('Studio — Maya MASH distribute scatters instances (slice 287)', async () => {
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
      goal: 'mash demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'cube', pos: [0, 0, 0], scale: [4, 4, 4], color: '#abc' }],
      expect: { bodies: 1, kinds: ['cube'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);

  const sourceUuid = await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    return m ? m.uuid : null;
  });
  expect(sourceUuid).toBeTruthy();

  const res = await win.evaluate(({ uuid }) => window.__studioMashDistribute({
    sourceUuid: uuid, count: 3, mode: 'grid', posJitter: 0.005, seed: 7,
  }), { uuid: sourceUuid });
  expect(res).toBeTruthy();
  expect(res.count).toBe(9);
  expect(res.mode).toBe('grid');

  const probe = await win.evaluate(({ instUuid }) => {
    let inst = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === instUuid) inst = o; });
    const m0 = new (window.THREE || (window.__THREE = window.__archdiscScene.constructor)).Matrix4 ? new inst.matrix.constructor() : null;
    // Use raw matrix elements via getMatrixAt
    const M = inst.matrixWorld.constructor;
    const A = new M(), B = new M();
    inst.getMatrixAt(0, A); inst.getMatrixAt(4, B);
    return {
      isInst: inst.isInstancedMesh === true,
      cnt: inst.count,
      seed: inst.userData.archdiscStudioMash.seed,
      px0: A.elements[12], pz0: A.elements[14],
      px4: B.elements[12], pz4: B.elements[14],
    };
  }, { instUuid: res.uuid });
  expect(probe.isInst).toBe(true);
  expect(probe.cnt).toBe(9);
  expect(probe.seed).toBe(7);
  const sameSpot = Math.abs(probe.px0 - probe.px4) < 1e-4 && Math.abs(probe.pz0 - probe.pz4) < 1e-4;
  expect(sameSpot).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 287: MASH grid 3x3 scattered', probe.cnt, 'instances');

  await app.close();
});
