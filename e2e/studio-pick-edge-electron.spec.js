import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-pick-edge');

test('Studio — Plasticity per-edge pick + highlight (slice 301)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioListEdges === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'pick edge demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'cube', pos: [0, 0, 0], scale: [4, 4, 4], color: '#bba' }],
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
  await win.waitForTimeout(300);

  // Cube is non-indexed at creation; expect 18 unique edges (24 verts, 12 triangles, 36 edge slots, 18 unique).
  const edges = await win.evaluate(({ u }) => window.__studioListEdges(u), { u: uuid });
  expect(edges.length).toBeGreaterThan(10);

  const pick = await win.evaluate(({ u }) => window.__studioPickEdge(u, 0), { u: uuid });
  expect(pick.ok).toBe(true);
  expect(pick.length).toBeGreaterThan(0);

  // Highlight present.
  const present = await win.evaluate(() => {
    let count = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscPickedEdge) count++; });
    return count;
  });
  expect(present).toBe(1);
  await win.screenshot({ path: path.join(OUT, '00-picked.png') });
  await win.waitForTimeout(400);

  // Clear.
  const cleared = await win.evaluate(() => window.__studioClearEdgeSelection());
  expect(cleared.ok).toBe(true);
  expect(cleared.cleared).toBe(true);
  const absent = await win.evaluate(() => {
    let count = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscPickedEdge) count++; });
    return count;
  });
  expect(absent).toBe(0);
  await win.screenshot({ path: path.join(OUT, '01-cleared.png') });

  // Out-of-range pick returns error.
  const bad = await win.evaluate(({ u }) => window.__studioPickEdge(u, 99999), { u: uuid });
  expect(bad.ok).toBe(false);

  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 301: pick-edge listed', edges.length, 'edges; highlight on/off worked');

  await app.close();
});
