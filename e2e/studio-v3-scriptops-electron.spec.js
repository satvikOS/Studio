import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-scriptops');

test('Studio V3 — VEX / Grasshopper / TaskGraph (slice 414)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
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
  await win.waitForFunction(() => typeof window.__studioRunVexExpr === 'function', null, { timeout: 15000 });

  // ─── VEX ──────────────────────────────────────────────────────────────
  // Spawn a cube + run a VEX expression that bumps Y on every vert.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  let r = await win.evaluate(() => window.__studioRunVexExpr('[P.x, P.y + 0.01, P.z]'));
  expect(r.ok).toBe(true);
  expect(r.changed).toBeGreaterThan(0);

  // Bad expr.
  r = await win.evaluate(() => window.__studioRunVexExpr('this is not js'));
  expect(r.ok).toBe(false);

  // ─── Grasshopper ──────────────────────────────────────────────────────
  r = await win.evaluate(() => window.__studioRunGrasshopper({
    nodes: [
      { id: 'n1', type: 'number',   params: { value: 3 } },
      { id: 'n2', type: 'number',   params: { value: 4 } },
      { id: 'n3', type: 'add',      params: {} },
    ],
    wires: [{ from: 'n1.out', to: 'n3.a' }, { from: 'n2.out', to: 'n3.b' }],
  }));
  expect(r.ok).toBe(true);
  const out = r.nodes.find((n) => n.id === 'n3');
  expect(out.output).toBe(7);

  // SpawnPoints adds a primitive.
  const before = await win.evaluate(() => {
    let n = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n;
  });
  r = await win.evaluate(() => window.__studioRunGrasshopper({
    nodes: [
      { id: 'p1', type: 'spawnPoints', params: { points: [[0, 0, 0], [0.05, 0, 0], [0, 0.05, 0]] } },
    ],
    wires: [],
  }));
  expect(r.ok).toBe(true);
  expect(r.spawned).toBeTruthy();
  const after = await win.evaluate(() => {
    let n = 0;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n;
  });
  expect(after).toBe(before + 1);

  // ─── TaskGraph ─────────────────────────────────────────────────────────
  // wait → spawn → wait. Verifies DAG ordering + status: ok on each.
  r = await win.evaluate(() => window.__studioRunTaskGraph({
    tasks: [
      { id: 't1', op: 'wait',  params: { ms: 10 } },
      { id: 't2', op: 'spawn', params: { kind: 'sphere' }, dependsOn: ['t1'] },
      { id: 't3', op: 'wait',  params: { ms: 10 }, dependsOn: ['t2'] },
    ],
  }));
  expect(r.ok).toBe(true);
  expect(r.tasks.length).toBe(3);
  for (const t of r.tasks) expect(t.status).toBe('ok');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 414: VEX + Grasshopper + TaskGraph all execute');

  await app.close();
});
