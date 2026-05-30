import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-instanced-stress');

test('Studio — InstancedMesh stress spawn renders 1000 cubes in few draw calls (slice 260)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioInstancedStress === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Spawn + select a viewer-dominant cube as the source mesh.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'instanced stress demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'cube', pos: [0, 0, 0], scale: [3, 3, 3], color: '#9ab' }],
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
  await win.waitForTimeout(300);

  await win.evaluate(() => window.__studioInstancedStress(1000));
  await win.waitForTimeout(700);

  const stats = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    return {
      tris: vp.renderer.info.render.triangles,
      calls: vp.renderer.info.render.calls,
      lastCount: window.__studioLastInstancedCount,
    };
  });
  // 1000 cubes × 12 tris each = 12,000 triangles via 1 draw call
  // (Three.js InstancedMesh batches everything into one geometry).
  expect(stats.lastCount).toBe(1000);
  expect(stats.tris, '1000 instances raise the tri count').toBeGreaterThan(10000);
  expect(stats.calls, 'few draw calls for 1000 instances').toBeLessThan(20);
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '00-thousand-cubes.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 260: 1000 instanced cubes, tris=', stats.tris, 'calls=', stats.calls);

  await app.close();
});
