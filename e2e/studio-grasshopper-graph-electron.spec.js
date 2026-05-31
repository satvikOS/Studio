import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-grasshopper-graph');

test('Studio — Rhino Grasshopper-style dataflow graph (slice 298)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioRunGrasshopper === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Case 1: 2*3 = 6
  const r1 = await win.evaluate(() => window.__studioRunGrasshopper({
    nodes: [
      { id: 'a', type: 'number',   params: { value: 2 } },
      { id: 'b', type: 'number',   params: { value: 3 } },
      { id: 'm', type: 'multiply' },
    ],
    wires: [{ from: 'a.out', to: 'm.a' }, { from: 'b.out', to: 'm.b' }],
  }));
  expect(r1.error).toBeUndefined();
  const mNode = r1.nodes.find((n) => n.id === 'm');
  expect(mNode.output).toBe(6);

  // Case 2: spawn 2 points via Grasshopper.
  const before = await win.evaluate(() => window.__archdiscScene.children.length);
  const r2 = await win.evaluate(() => window.__studioRunGrasshopper({
    nodes: [
      { id: 'p1', type: 'point',       params: { x: 0, y: 0.5, z: 0 } },
      { id: 'p2', type: 'point',       params: { x: 1, y: 0.5, z: 0 } },
      { id: 'sp', type: 'spawnPoints', params: { points: [[0, 0.5, 0], [1, 0.5, 0]] } },
    ],
    wires: [],
  }));
  expect(r2.spawned).toBeTruthy();
  const after = await win.evaluate(() => window.__archdiscScene.children.length);
  expect(after).toBeGreaterThan(before);

  // Case 3: cycle detection.
  const r3 = await win.evaluate(() => window.__studioRunGrasshopper({
    nodes: [{ id: 'a', type: 'add' }, { id: 'b', type: 'add' }],
    wires: [{ from: 'a.out', to: 'b.a' }, { from: 'b.out', to: 'a.a' }],
  }));
  expect(r3.error).toBe('cycle');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 298: grasshopper graph evaluated multiply=6 and spawned points; cycle rejected');

  await app.close();
});
