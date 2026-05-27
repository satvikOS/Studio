import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 19 — Instanced rendering (AAA-game-asset replication).
 *
 * Pick a primitive, hit Instance Selected as Swarm → N instances of
 * that primitive's geometry + material land as a THREE.InstancedMesh
 * (one draw call) scattered in a spherical shell with random
 * positions / rotations / scales. The swarm itself is a Studio
 * primitive so it counts in the scene tally and disposes normally.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-instancing');

async function screenPosOfMesh(win, index) {
  return await win.evaluate(({ idx }) => {
    const vp = window.__archdiscViewport;
    const meshes = [];
    vp.scene.traverse(o => {
      if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) meshes.push(o);
    });
    const mesh = meshes[idx];
    if (!mesh) return null;
    const v = mesh.position.clone().project(vp.camera);
    const rect = vp.renderer.domElement.getBoundingClientRect();
    return {
      x: (v.x + 1) / 2 * rect.width + rect.left,
      y: (-v.y + 1) / 2 * rect.height + rect.top,
    };
  }, { idx: index });
}

async function setRange(win, selector, value) {
  await win.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel: selector, val: value });
}

test('Studio instancing — clone selected primitive into a 500-instance swarm', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 300,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await expect(win.locator('[data-studio-section="instancing"]')).toBeVisible();
  await expect(win.locator('[data-studio-action="spawn-swarm"]')).toBeDisabled();

  // ---- Add a cube and select it ----
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  const cubePos = await screenPosOfMesh(win, 0);
  await win.mouse.click(cubePos.x, cubePos.y);
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-action="spawn-swarm"]')).toBeEnabled();
  await win.screenshot({ path: path.join(OUT, '00-cube-selected.png'), fullPage: false });

  // ---- Spawn at default 500 ----
  await win.locator('[data-studio-action="spawn-swarm"]').click();
  await win.waitForTimeout(600);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('2 primitives in scene');
  const swarm0 = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let im = null;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'instanced-swarm') im = o;
    });
    if (!im) return null;
    return { isInstanced: !!im.isInstancedMesh, count: im.count, recorded: im.userData.archdiscStudioInstanceCount };
  });
  expect(swarm0).not.toBeNull();
  expect(swarm0.isInstanced).toBe(true);
  expect(swarm0.count).toBe(500);
  expect(swarm0.recorded).toBe(500);

  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(30, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-swarm-500.png'), fullPage: false });

  // ---- Bump count to 2000, larger radius, spawn another swarm ----
  await setRange(win, '[data-studio-instancing="count"]',  '2000');
  await setRange(win, '[data-studio-instancing="radius"]', '0.15');
  await expect(win.locator('[data-studio-instancing-readout="count"]')).toHaveText('2000');
  await expect(win.locator('[data-studio-instancing-readout="radius"]')).toHaveText('150 mm');

  // Pick the original cube again (raycast still hits the small cube,
  // not the swarm's outer instances — they're 80mm out from the swarm's
  // own group position, which sits in the next grid cell.
  const cubePos2 = await screenPosOfMesh(win, 0);
  await win.mouse.click(cubePos2.x, cubePos2.y);
  await win.waitForTimeout(400);

  await win.locator('[data-studio-action="spawn-swarm"]').click();
  await win.waitForTimeout(800);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('3 primitives in scene');

  const totalInstances = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let total = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'instanced-swarm') {
        total += o.count;
      }
    });
    return total;
  });
  expect(totalInstances).toBe(500 + 2000);

  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(45, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '02-two-swarms-az45.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(225, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '03-two-swarms-az225.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  instancing: 500 → +2000 (total ${totalInstances} instances across 2 swarms, 2 draw calls)`);

  await app.close();
});
