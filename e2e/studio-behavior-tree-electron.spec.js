import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — BEHAVIOUR TREE / AI (headed Electron).
 *
 * Closes the Unreal Behavior Tree + Blackboard / Unity Behavior Designer gap: a
 * tickable AI tree on the shared node-graph engine. The seed tree is
 *   Selector[ Sequence[ Condition:reachedTarget, Action:arrive ], Action:moveToward ]
 * driving the selected mesh (agent) toward a blackboard target. Verifies that
 * ticking moves the agent toward the target (moveToward branch), and once within
 * threshold the tree switches to the arrive branch (agent turns green, stops).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-behavior-tree');

test('Studio — behaviour tree drives an agent: move toward target then arrive', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioBTTick === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // agent at the origin, selected
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(250);
  await win.evaluate(() => { const s = window.__archdiscScene; let m = null; s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) m = o; }); if (m) { m.position.set(0, 0, 0); window.__studioSelectMesh(m); } });
  await win.waitForTimeout(150);

  // ── open the Behaviour Tree editor; seed tree present ──
  await win.locator('[data-studio-ribbon-action="behaviortree-editor"]').click();
  await expect(win.locator('[data-studio-nodegraph="behaviortree"]')).toBeVisible({ timeout: 10000 });
  await expect(win.locator('[data-studio-nodegraph-node="root"]')).toBeVisible();
  await expect(win.locator('[data-studio-nodegraph-node="selector"]')).toBeVisible();
  await expect(win.locator('[data-studio-nodegraph-node="sequence"]')).toBeVisible();
  await expect(win.locator('[data-studio-nodegraph-add="condition"]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '01-behavior-tree.png') });

  // ── one tick: agent is far -> Selector falls through to the moveToward leaf ──
  const t1 = await win.evaluate(() => window.__studioBTTick(1));
  expect(t1.status, 'tree ticked to SUCCESS (moveToward)').toBe('SUCCESS');
  expect(t1.agentX, 'agent stepped toward the target').toBeGreaterThan(0.03);
  expect(t1.log.join(','), 'far state ran the moveToward action').toContain('moveToward');

  // ── tick to convergence: agent reaches target, switches to the arrive branch ──
  const t2 = await win.evaluate(() => window.__studioBTTick(15));
  expect(t2.dist, 'agent reached the target (within threshold)').toBeLessThan(0.05);
  expect(t2.log.join(','), 'reached state ran the arrive action (not moveToward)').toContain('arrive');
  expect(t2.log.join(','), 'arrive branch no longer moves').not.toContain('moveToward');
  expect(t2.color, 'arrive action recoloured the agent green').toBe('3ad07a');

  await win.locator('[data-studio-nodegraph-action="close"]').click();
  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(22, 12, 1.3); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '02-agent-arrived.png') });

  // eslint-disable-next-line no-console
  console.log(`  behaviortree: tick1 status=${t1.status} x=${t1.agentX.toFixed(2)} [${t1.log}]; converged dist=${t2.dist.toFixed(3)} color=${t2.color} [${t2.log}]`);

  await app.close();
});
