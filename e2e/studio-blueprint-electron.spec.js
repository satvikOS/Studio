import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — BLUEPRINT / VISUAL SCRIPTING (headed Electron).
 *
 * Closes the Unreal Blueprint / Unity Visual Scripting gap. Reuses the
 * generalized node-graph editor as an EXECUTION-flow graph: an Event BeginPlay
 * fires and control follows the exec wire through Spawn -> Move -> Set Color,
 * each node acting on the live scene (data pins thread the spawned object).
 * Verifies the seed graph RUNS — spawning a cube, translating it, and recolouring
 * it — and the engine via hook drives Spawn -> Scale -> Rotate on a sphere.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blueprint');

test('Studio — blueprint exec-flow graph spawns and acts on scene objects', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioRunBlueprint === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  const primCount = () => win.evaluate(() => { let n = 0; const s = window.__archdiscScene; s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; }); return n; });

  // ── 1) open the Blueprint editor (Engine·Advanced, modeling tab) ──
  await win.locator('[data-studio-ribbon-action="blueprint-editor"]').click();
  await expect(win.locator('[data-studio-nodegraph="blueprint"]')).toBeVisible({ timeout: 10000 });
  await expect(win.locator('[data-studio-nodegraph-node="eventBeginPlay"]')).toBeVisible();
  await expect(win.locator('[data-studio-nodegraph-node="spawn"]')).toBeVisible();
  await expect(win.locator('[data-studio-nodegraph-node="setColor"]')).toBeVisible();
  // blueprint-only palette nodes
  await expect(win.locator('[data-studio-nodegraph-add="rotate"]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '01-blueprint-graph.png') });

  // ── 2) Run the seed graph: Event -> Spawn cube -> Move(+0.3x) -> Set Color red ──
  const before = await primCount();
  await win.locator('[data-studio-nodegraph-action="evaluate"]').click();
  await win.waitForTimeout(400);
  expect(await primCount(), 'blueprint Spawn node added a primitive').toBe(before + 1);

  // find the recoloured cube the blueprint produced
  const made = await win.evaluate(() => {
    const s = window.__archdiscScene; let found = null;
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive && o.material && o.material.color && o.material.map == null) { const h = o.material.color.getHexString(); if (h === 'cc2222') found = o; } });
    return found ? { x: found.position.x, kind: found.userData.archdiscStudioPrimitiveKind, hex: found.material.color.getHexString() } : null;
  });
  expect(made, 'the blueprint-built cube exists').not.toBeNull();
  expect(made.kind, 'Spawn node made a cube').toBe('cube');
  expect(Math.abs(made.x - 0.3), 'Move node translated it +0.3 in x').toBeLessThan(0.02);
  expect(made.hex, 'Set Color node recoloured it red (cc2222)').toBe('cc2222');

  await win.locator('[data-studio-nodegraph-action="close"]').click();
  await expect(win.locator('[data-studio-nodegraph="blueprint"]')).toHaveCount(0);

  // ── 3) engine via hook: Event -> Spawn sphere(0.5,0,0) -> Scale x2 -> Rotate ry ──
  const r = await win.evaluate(() => window.__studioRunBlueprint({
    nodes: [
      { id: 'e', type: 'eventBeginPlay', params: {} },
      { id: 's', type: 'spawn', params: { kind: 'sphere', x: 0.5, y: 0, z: 0 } },
      { id: 'sc', type: 'scale', params: { s: 2 } },
      { id: 'ro', type: 'rotate', params: { rx: 0, ry: 0.5, rz: 0 } },
    ],
    edges: [
      { from: { node: 'e', port: 'exec' }, to: { node: 's', port: 'exec' } },
      { from: { node: 's', port: 'exec' }, to: { node: 'sc', port: 'exec' } },
      { from: { node: 's', port: 'object' }, to: { node: 'sc', port: 'target' } },
      { from: { node: 'sc', port: 'exec' }, to: { node: 'ro', port: 'exec' } },
      { from: { node: 's', port: 'object' }, to: { node: 'ro', port: 'target' } },
    ],
  }));
  expect(r.error, 'blueprint ran without error').toBeFalsy();
  expect(r.ran, 'four exec nodes ran').toBe(4);
  const sphere = await win.evaluate(() => {
    const s = window.__archdiscScene; let found = null;
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') found = o; });
    return found ? { sx: found.scale.x, ry: found.rotation.y, x: found.position.x } : null;
  });
  expect(sphere, 'sphere spawned by the hook graph').not.toBeNull();
  expect(Math.abs(sphere.x - 0.5), 'sphere spawned at x=0.5').toBeLessThan(0.02);
  expect(Math.abs(sphere.sx - 2), 'Scale node scaled the sphere x2').toBeLessThan(0.02);
  expect(Math.abs(sphere.ry - 0.5), 'Rotate node turned the sphere ry=0.5').toBeLessThan(0.02);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(22, 14, 1.3); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '02-blueprint-result.png') });

  // eslint-disable-next-line no-console
  console.log(`  blueprint: seed -> ${made.kind} @x=${made.x.toFixed(2)} color #${made.hex}; hook ran=${r.ran} [${r.log.join(' / ')}]; sphere scale=${sphere.sx.toFixed(2)} ry=${sphere.ry.toFixed(2)}`);

  await app.close();
});
